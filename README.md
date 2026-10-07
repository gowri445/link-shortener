
# Link Shortener

Live: <paste your Render link here>

A small URL shortener built with Node.js, Express and MongoDB.

## How it works
- POST /shorten with {"url": "https://example.com"} returns a short code
- GET /:code redirects to the original link
- An in-memory LRU cache sits in front of MongoDB on the redirect path
- Clicks are buffered in memory and written with bulkWrite every 5 seconds
- Codes are random, with a unique _id and a retry if two codes collide
- Only http and https links are accepted

## Trade-off
A crash can lose up to 5 seconds of click counts. I accepted this to keep redirects fast.

## Run locally
MONGODB_URI=<your connection string> npm start
