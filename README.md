# jellyfin-screenshot

This is a tool for taking screenshots of the movie that is currently playing in jellyfin for a user.

I liked the idea to capture movie moments from my phone while sitting in my couch watching the tv, without needing to pull up the same timestamp on a second device.

### Origin Notes
This repo comes from https://gitlab.com/MatiasArriola/jellyfin-screenshot, which I cannot fork. I have preserved the license and commit history, and would be happy to transfer ownership to the original creator.

### What to expect

While I use this a lot and suits my needs for now, the lib might fail for some video/subtitles formats. This is quick & dirty project that just works.
If you are running a public jellyfin instance, or you are worried about security, be worried. There is no authentication out of the box, so anyone could hit your jellyfin-screenshot url:port and take as many screenshots as they want for any user. The output files are only accessible for those with access to the output folder, and this project won't provide any mean to explore them.

## How it works

It queries the jellyfin api to check for the currently playing streams for a user. Once obtained file(s) and timestamps, calls ffmpeg to extract and save that frame as an image, and parses the subs to save that fragment as a text file.

## Getting started

    git clone git@gitlab.com:MatiasArriola/jellyfin-screenshot.git

Open the docker-compose.yml file and edit the volumes, environment variables and the port mapping if needed.

    - ~/jellyfin/screenshots:/usr/src/app/out
    - ~/jellyfin/media:/media:ro

- `~/jellyfin/screenshots` is the directory in my machine for saving the screenshots. You can later search your screenshots in `~/jellyfin/screenshots/Movie-Name/`.
- `~/jellyfin/media` is the media folder configured in my jellyfin instance (installed via docker in the same machine). It is important that is the same jellyfin folder, otherwise the paths returned by the jellyfin api won't resolve correctly.
- `JELLYFIN_API_KEY`: can be created in the jellyfin dashboard -> Advanced -> API Keys

Once everything is configured run 

`docker-compose up` and navigate to your ip/address:port

## Roadmap - Ideas

- improve loading state
- add offset option? (would be used to correct delayed screenshots by subtracting some ms from timestamp to seek)
- fix footer for long error messages
- complementary software:
    - review the images and provide caption, or a commetary (quick, gallery-style: next, write, tick tick, next)
    - site generator (minimal options, template allowed, from: pics, subs, captions, metadata)
- Support subtitles format `.ass`
- Burn Subtitles into output image
- save logs to /var/log instead of stdout
- tests? - not a single test yet!!
- publish docker image, setup docker-compose using image instead of build?
