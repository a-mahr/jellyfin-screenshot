# jellyfin-screenshot

This is a tool for taking screenshots of the movie that is currently playing in jellyfin for a user.

I liked the idea to capture movie moments from my phone while sitting in my couch watching the tv, without needing to pull up the same timestamp on a second device.

### Origin Notes
This repo comes from https://gitlab.com/MatiasArriola/jellyfin-screenshot, which I cannot fork. I have preserved the license and commit history, and would be happy to transfer ownership to the original creator.

### What to expect

While I use this a lot and suits my needs for now, the lib might fail for some video/subtitles formats. This is quick & dirty project that just works.
### Security (None)
- If you are running a public jellyfin instance, or you are worried about security, be worried.
- The target use case is for an internal network. This is not designed to be exposed.
- There is no authentication out of the box, so anyone could hit your jellyfin-screenshot url:port and take as many screenshots as they want for any user. The output files are only accessible for those with access to the output folder. If you expose your output folder, consider what has access.

## How it works

It queries the jellyfin api to check for the currently playing streams for a user. Once obtained file(s) and timestamps, calls ffmpeg to extract and save that frame as an image, and parses the subs to save that fragment as a text file.

## Getting started

    git clone git@github.com:a-mahr/jellyfin-screenshot.git

1. Using the sample-compose.yaml file, create compose.yaml and edit the volumes, environment variables and the port mapping if needed.
```
cp sample-compose.yaml compose.yaml
```

 - `~/jellyfin/screenshots` is the directory in my machine for saving the screenshots. You can later search your screenshots in `~/jellyfin/screenshots/Movie-Name/`.
- `~/jellyfin/media` is the media folder configured in my jellyfin instance (installed via docker in the same machine). It is important that is the same jellyfin folder, otherwise the paths returned by the jellyfin api won't resolve correctly.
- `JELLYFIN_API_KEY`: Can be created in the jellyfin dashboard -> Advanced -> API Keys
- `JELLYFIN_USER`: Optional. A default user to search on.
- `JELLYFIN_URL`: Base URL at which this container can reach Jellyfin.
- `SCREENSHOTS_DIR_URL`: Optional. Base URL at which screenshots can be retrieved. If this is not a working URL, screenshots must be retrieved manually. Consider exposing your screenshots directory for greater usability. Can be relative (/screenshots/) or absolute ("https://localhost/screenshots/")
- `DEBUG`: true if additional logging is needed to investigate an issue.

2. Once everything is configured run 

```
docker compose up -d
``` 
and navigate to your ip/address:port


## Nginx Config
### Docker Container
Very little nginx config is required for this container:
```
location /jellyfin-screenshot/ {
		proxy_pass http://localhost:8080/;
	}
```

### Screenshots Directory URL
To configure a screenshots directory URL, consider the following steps:
1. On an existing nginx server, add a location, carefully considering what files might be available
```
root /somewhere/www;
server_name myhost;
location / {
		autoindex on;
		# First attempt to serve request as file, then
		# as directory, then fall back to displaying a 404.
		try_files $uri $uri/ =404;
	}
```
2. Either set your screenshots directory to that location from the root directory, or else create a symlink in the root directory to the screenshots directory
```
ln -s /media/screenshots /var/www/screenshots
```

# Build / Update
- `pnpm install` for current versions of packages
- `pnpm outdated` or `pnpm audit` for proposed upgrades
- `docker compose up --build --force-recreate -d` to force container builds

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
