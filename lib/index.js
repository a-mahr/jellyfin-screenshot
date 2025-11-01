/* eslint-disable no-underscore-dangle */
const { Env } = require('@humanwhocodes/env');

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const slugify = require('slugify');

const { parse, filter } = require('subtitle');
const { Transform } = require('stream');

const fsPromises = fs.promises;
const env = new Env();

const JELLYFIN_URL = env.get('JELLYFIN_URL', 'http://localhost:8096');
const JELLYFIN_API_KEY = env.require('JELLYFIN_API_KEY');
const JELLYFIN_USER = env.get('JELLYFIN_USER', '');
const OUTPUT_DIR = './out';

const getItem = async (userId, itemId) => {
  const url = new URL(`${JELLYFIN_URL}/Users/${userId}/Items/${itemId}`);
  url.searchParams.append('API_KEY', JELLYFIN_API_KEY);
  const r = await fetch(url);
  return r.json();
};

const getSessions = async () => {
  const url = new URL(`${JELLYFIN_URL}/Sessions`);
  url.searchParams.append('API_KEY', JELLYFIN_API_KEY);
  const r = await fetch(url);
  return r.json();
};

const getSessionsForUser = async (username) => {
  const sessions = await getSessions();
  const filteredSessions = sessions.filter((session) => !!session.NowPlayingItem
    && session.UserName === username);
  const sessionsItemData = await Promise.all(
    filteredSessions.map((s) => getItem(s.UserId, s.NowPlayingItem.Id)),
  );

  return filteredSessions.map((s, i) => ({
    ...s,
    _item: sessionsItemData[i],
  }));
};

const ticksToMs = (ticks) => ticks / 10000;

const msToTime = (duration, onlyDots = true) => {
  // from https://stackoverflow.com/a/19700358/58128
  const milliseconds = parseInt((duration % 1000) / 100, 10);
  let seconds = Math.floor((duration / 1000) % 60);
  let minutes = Math.floor((duration / (1000 * 60)) % 60);
  let hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

  hours = (hours < 10) ? `0${hours}` : hours;
  minutes = (minutes < 10) ? `0${minutes}` : minutes;
  seconds = (seconds < 10) ? `0${seconds}` : seconds;

  if (onlyDots) {
    return `${hours}.${minutes}.${seconds}.${milliseconds}`;
  }
  return `${hours}:${minutes}:${seconds},${milliseconds.toString().padEnd(3, '0')}`;
};

const getSlug = (name) => slugify(name, {
  remove: /[*+~.,()'"!:@]/g,
});

const getOutputFolderNameForTvShow = (session) => {
  // TODO: check how to reliably get the season and episode numbers
  const { SeriesName, SeasonName, SortName } = session._item;
  // in some tests it came as "001 - 0005 - Episode 5 name" and in others "01 - long string"
  const episodeFolderMatchingTwoNbrs = SortName.match(/^(\d+) - (\d+)/);
  const episodeFolder = episodeFolderMatchingTwoNbrs
    ? episodeFolderMatchingTwoNbrs[2] : SortName.split(' -')[0];
  const out = `${getSlug(SeriesName)}/${getSlug(SeasonName)}/${getSlug(episodeFolder)}`;
  return out;
};

// returns the movie-name-slugified
// or tv-show-name-slugified/seasion-01/episode-001
const getOutputFolderName = (session) => (session._item.Type === 'Episode'
  ? getOutputFolderNameForTvShow(session)
  : getSlug(session._item.Name));

const sessionToDTO = (session) => {
  const subs1 = session.NowPlayingItem.SubtitleFiles?.[0];
  const subs2 = session.NowPlayingItem.MediaStreams.find(
    (media) => media.Type === 'Subtitle',
  )?.Path;
  const subtitle = subs1 || subs2;
  const item = session._item;
  return {
    outputPath: getOutputFolderName(session),
    path: session.NowPlayingItem.Path,
    position: ticksToMs(session.PlayState.PositionTicks) / 1000,
    subtitle,
    meta: {
      name: item.Name,
      originalTitle: item.OriginalTitle,
      genres: item.Genres,
      overview: item.Overview,
      resolution: {
        width: item.Width,
        height: item.Height,
      },
      runTimeTicks: item.RunTimeTicks,
      premiereDate: item.PremiereDate,
      productionLocations: item.ProductionLocations,
      ...item.ProviderIds,
      path: session.NowPlayingItem.Path,
      subtitle,
    },
  };
};

const seekCaption = (subtitleFile, time, destination) => {
  if (subtitleFile.endsWith('.ass')) {
    return Promise.reject(new Error('.ass subtitle files not yet supported'));
  }
  const timeToSeek = time * 1000;
  const destinationFullPath = path.join(destination, `${msToTime(timeToSeek)}.subs.txt`);
  const transformToTextOnly = new Transform({
    objectMode: true,
    autoDestroy: true,
    transform(chunk, _encoding, callback) {
      this.push(chunk?.data?.text?.toString());
      callback();
    },
  });

  return new Promise((resolve, reject) => {
    const data = '';
    const outputStream = fs.createWriteStream(destinationFullPath, 'utf8')
      .on('data', (d) => {
        resolve(d);
      })
      .on('close', () => resolve(data))
      .on('error', (err) => reject(err))
      .on('finish', () => resolve(data));

    // TODO: understand why utf8 does not work???
    const inputStream = fs.createReadStream(subtitleFile, 'latin1');
    inputStream
      .pipe(parse())
      .pipe(
        filter(
          (node) => (
            node.data.start <= timeToSeek
            && node.data.end >= timeToSeek
          ),
        ),
      )
      .pipe(transformToTextOnly)
      .pipe(outputStream);
    // TODO: resolve after outputStream ends? finish never triggering
    inputStream.on('finish', () => {
      resolve();
    });
    inputStream.on('error', (err) => reject(err));
    inputStream.read();
  });
};

const resolveOutputFolder = (name) => path.resolve(process.cwd(), path.join(OUTPUT_DIR, name));

const generateScreenshot = async (dto, options) => {
  const withSubtitle = options.withSubtitle && !!dto.subtitle;
  const filename = `${msToTime(dto.position * 1000)}.jpg`;
  const folder = resolveOutputFolder(dto.outputPath);
  const outputFilename = path.join(folder, filename);
  // TODO: Fix withSubtitle option, failing with different errors depending on the movie
  const args = [
    '-y',
    '-hide_banner',
    '-ss', dto.position,
    withSubtitle ? '-copyts' : '',
    '-i', `'${path.resolve(process.cwd(), dto.path)}'`,
    withSubtitle ? '-vf' : '', withSubtitle ? `"subtitles='${dto.subtitle}'"` : '',
    '-vframes', '1',
    '-q:v', '2',
    outputFilename,
  ];
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { env: process.env, cwd: process.cwd(), shell: true });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.on('error', (err) => {
      reject(err);
    });
    proc.on('exit', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited with code ${code}\nstderr: ${stderr}`));
      }
      return resolve({ ...dto, outputFilename: filename });
    });
  });
};

const writeMetadata = (info, folder) => {
  const output = path.join(folder, 'metadata.json');
  // don't want to write again, write only if file does not exist.
  return fsPromises.access(output, fs.constants.F_OK)
    .catch(() => fsPromises.writeFile(output, JSON.stringify(info.meta, null, 4)));
};

const takeScreenshot = async (opts = { withSubtitle: false }) => {
  const sessionsForUser = await getSessionsForUser(opts.username || JELLYFIN_USER);
  const inputs = sessionsForUser.map((session) => sessionToDTO(session));
  if (inputs.length === 0) {
    throw new Error('No sessions for user detected');
  }

  const folder = resolveOutputFolder(inputs[0].outputPath);
  await fsPromises.mkdir(folder, { recursive: true });

  await writeMetadata(inputs[0], folder);

  if (opts.withSubtitle) {
    // TODO: add await once function is correctly implemented
    seekCaption(inputs[0].subtitle, inputs[0].position, folder)
      // eslint-disable-next-line no-console
      .catch(console.error);
  }
  return {
    sessionsForUser: sessionsForUser.length,
    result: await generateScreenshot(inputs[0], {
      // TODO: decide if using opts.withSubtitle option or change name
      //   since already saving .txt subs with that option
      withSubtitle: false,
    }),
  };
};

module.exports = {
  takeScreenshot,
};
