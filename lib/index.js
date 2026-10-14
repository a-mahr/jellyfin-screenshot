/* eslint-disable no-underscore-dangle */
// Backend Functions
const { Env } = require('@humanwhocodes/env');

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const slugify = require('slugify');

const { parse, filter } = require('subtitle');
const { Transform } = require('stream');

const fsPromises = fs.promises;
const env = new Env();

const JELLYFIN_URL = env.get('JELLYFIN_URL', 'http://localhost:8096');
const JELLYFIN_API_KEY = env.require('JELLYFIN_API_KEY');
const JELLYFIN_USER = env.get('JELLYFIN_USER', '');
const SCREENSHOTS_DIR_URL = env.get('SCREENSHOTS_DIR_URL', '');
const DEBUG = env.get('DEBUG', false);
const OUTPUT_DIR = './out';

const getItem = async (userId, itemId) => {
  const url = new URL(`${JELLYFIN_URL}/Users/${userId}/Items/${itemId}`);
  const r = await fetch(url, {
      method: 'GET', // Or 'POST', 'PUT', etc.
      headers: {
        'Authorization': 'MediaBrowser Token="' + JELLYFIN_API_KEY + '"',
      },
      });
  return r.json();
};

const getSessions = async () => {
  const url = new URL(`${JELLYFIN_URL}/Sessions`);
  const r = await fetch(url, {
      method: 'GET', // Or 'POST', 'PUT', etc.
      headers: {
        'Authorization': 'MediaBrowser Token="' + JELLYFIN_API_KEY + '"',
      },
      });
  if (DEBUG) {
    console.log("GetSessions Status: " + r.status);
  }
  return r.json();
};

const getSessionsForUser = async (username) => {
  const sessions = await getSessions();
  if (DEBUG) {
    console.log(sessions);
  }
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

/**
 * 
 * @param {object} session from sessionToDTO
 * @returns movie-name-slugified or tv-show-name-slugified/seasion-01/episode-001
 */
const getOutputFolderName = (session) => (session._item.Type === 'Episode'
  ? getOutputFolderNameForTvShow(session)
  : getSlug(session._item.Name));

/**
 * 
 * @param {*} session 
 * @returns 
 * session
 *  outputPath - output folder name
 *  path - currently playing media path
 *  position - current timestamp ticks
 *  subtitle - name of subtitle file
 *  meta - metadata to save in metadata.json
 */
const sessionToDTO = (session) => {
  // check for a SubtitleFiles
  const subs1 = session.NowPlayingItem.SubtitleFiles?.[0];
  // check if the NowPlaying streams includes a path
  const subs2 = session.NowPlayingItem.MediaStreams.find(
    (media) => media.Type === 'Subtitle',
  )?.Path;
  const subtitle = subs1 || subs2
  const subtitleIndex = session.PlayState.SubtitleStreamIndex;

  // contains metadata
  const item = session._item;

  return {
    outputPath: getOutputFolderName(session),
    path: session.NowPlayingItem.Path,
    position: ticksToMs(session.PlayState.PositionTicks) / 1000,
    subtitle,
    subtitleIndex,
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
      subtitle: !!subtitle ? subtitle 
        : session.NowPlayingItem.MediaStreams
          .find(
            (media) => 
              media.Type === 'Subtitle' 
              && media.Index === subtitleIndex)
              ?.DisplayTitle ?? 'Unsbutitled',
    },
  };
};


const seekCaption = (subtitleFile, time, destination) => {
  if(!subtitleFile){
    return Promise.reject(new Error('No standalone subtitle file was located'))
  }
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
  const withSubtitle = options.withSubtitle && (!!dto.subtitle || !!dto.subtitleIndex);
  console.log(dto);
  console.log(options);
  const subtitleArg = (dto, options) => {
    // not desired or not present
    if (!options.withSubtitle
      || (!dto.subtitle && !dto.subtitleIndex)
    ){
      return ""
    }

    // from srt
    if (!!dto.subtitle)
    {
      return [`-vf`, `subtitles='${dto.subtitle}'`];
    }
    
    // from container (e.g. mkv)
    return [`-vf`, `subtitles='${dto.path}'`] //index from input 0
  }

  const filename = `${msToTime(dto.position * 1000)}.jpg`;
  const folder = resolveOutputFolder(dto.outputPath);
  const outputFilename = path.join(folder, filename);
  const displayFilename = path.join(dto.outputPath, filename);
  
  // TODO: Fix withSubtitle option, failing with different errors depending on the movie
  const args = [
    '-y',
    '-hide_banner',
   // i may be able to remove these later
    '-probesize', '250M', // 50 Megabytes (or higher if needed)
    '-analyzeduration', '5000000', // 500,000 microseconds = .5 seconds
    '-ss', dto.position,
    '-i', `${path.resolve(process.cwd(), dto.path)}`,
    withSubtitle ? '-copyts' : '',
    ...subtitleArg(dto,options),
    '-vframes', '1',
    '-q:v', '2',
    outputFilename,
  ].filter(Boolean); // remove empty strings

  console.log(args);
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { env: process.env, cwd: process.cwd(), shell: false });
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stderr +=chunk;});
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
      return resolve({ ...dto, outputFilename: displayFilename});
    });
  });
};

const writeMetadata = (info, folder) => {
  const output = path.join(folder, 'metadata.json');
  // don't want to write again, write only if file does not exist.
  return fsPromises.access(output, fs.constants.F_OK)
    .catch(() => fsPromises.writeFile(output, JSON.stringify(info.meta, null, 4)));
};

/**
 * takeScreenshot
 * Gets sessions, determines output, gets caption, and creates screenshot file
 * @param {object} opts object with boolean key withSubtitle, default false
 * @returns object with keys sessionsForUser : number, result: of generateScreenshot, and withSubtitle: false
 */
const takeScreenshot = async (opts = { withSubtitle: false , sessionId: 0}) => {
  const sessionsForUser = await getSessionsForUser(opts.username || JELLYFIN_USER);
  const inputs = sessionsForUser.map((session) => sessionToDTO(session));
  if (inputs.length === 0) {
    throw new Error('No sessions for user detected');
  }
  if (DEBUG) {
    console.log(inputs.length + " sessions for user " + opts.username);
  }

  const folder = resolveOutputFolder(inputs[opts.sessionId].outputPath);
  await fsPromises.mkdir(folder, { recursive: true });

  await writeMetadata(inputs[opts.sessionId], folder);

  if (opts.withSubtitle) {
    // TODO: add await once function is correctly implemented
    seekCaption(inputs[opts.sessionId].subtitle, inputs[opts.sessionId].position, folder)
      // eslint-disable-next-line no-console
      .catch(console.error);
  }
  return {
    sessionsForUser: sessionsForUser.length,
    result: await generateScreenshot(inputs[opts.sessionId], {
      // TODO: decide if using opts.withSubtitle option or change name
      //   since already saving .txt subs with that option
      withSubtitle: opts.withSubtitle,
    }),
    base_screenshots_url: SCREENSHOTS_DIR_URL
  };
};

module.exports = {
  takeScreenshot,
};
