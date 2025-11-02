FROM node:25-alpine
RUN apk add  --no-cache ffmpeg
RUN apk add --no-cache fontconfig ttf-dejavu

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
CMD [ "npm", "run", "start" ]
