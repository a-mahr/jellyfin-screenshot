const { Env } = require('@humanwhocodes/env');

const { spawn } = require('child_process');
const fs = require('fs');
const { promisify } = require('util');
const path = require('path');
const fetch = require('node-fetch');
const slugify = require('slugify');

const mkdir = promisify(fs.mkdir);
const { parse, filter } = require('subtitle');
const { Transform } = require('stream');

const env = new Env();

const JELLYFIN_URL = env.get('JELLYFIN_URL', 'http://localhost:8096');
const JELLYFIN_API_KEY = env.require('JELLYFIN_API_KEY');
const JELLYFIN_USER = env.get('JELLYFIN_USER', '');
const OUTPUT_DIR = './out';

const getSessions = async () => {
  const url = new URL(`${JELLYFIN_URL}/Sessions`);
  url.searchParams.append('API_KEY', JELLYFIN_API_KEY);
  const r = await fetch(url);
  return r.json();
};

const getSessionsForUser = async (username) => {
  const sessions = await getSessions();
  return sessions.filter((session) => !!session.NowPlayingItem
    && session.UserName === username);
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

const sessionToDTO = (session) => {
  const subs1 = session.FullNowPlayingItem.SubtitleFiles?.[0];
  const subs2 = session.NowPlayingItem.MediaStreams.find(
    (media) => media.Type === 'Subtitle',
  )?.Path;
  const subtitle = subs1 || subs2;
  return {
    path: session.NowPlayingItem.Path,
    position: ticksToMs(session.PlayState.PositionTicks) / 1000,
    subtitle,
    meta: {
      name: session.NowPlayingItem.Name,
      ...session.NowPlayingItem.ProviderIds,
    },
  };
};

const seekCaption = async (subtitleFile, time, destination) => {
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
    inputStream.read();
  });
};

const getOutputFolder = (name) => path.resolve(process.cwd(), path.join(OUTPUT_DIR, slugify(name, {
  remove: /[*+~.()'"!:@]/g,
})));

const generateScreenshot = async (dto, options) => {
  const withSubtitle = options.withSubtitle && !!dto.subtitle;
  const filename = `${msToTime(dto.position * 1000)}.jpg`;
  const folder = getOutputFolder(dto.meta.name);
  const outputFilename = path.join(folder, filename);
  await mkdir(folder, { recursive: true });
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

const takeScreenshot = async (opts = { withSubtitle: false }) => {
  const sessionsForUser = await getSessionsForUser(opts.username || JELLYFIN_USER);
  const inputs = sessionsForUser.map((session) => sessionToDTO(session));
  if (inputs.length === 0) {
    throw new Error('No sessions for user detected');
  }

  if (opts.withSubtitle) {
    // TODO: add await once function is correctly implemented
    seekCaption(inputs[0].subtitle, inputs[0].position, getOutputFolder(inputs[0].meta.name));
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
