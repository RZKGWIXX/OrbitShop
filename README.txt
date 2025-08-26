
Orbit Store - jsonbin.io adapter
---------------------------------
This small package provides server.js that reads/writes items and orders using jsonbin.io bins.

Files:
  - server.js        (the express server)
  - package.json     (dependencies)

Environment variables (set these in Render or your host):
  JSONBIN_ITEMS_BIN_ID   - jsonbin bin id for items (the bin should contain {"items": [...] } or an array)
  JSONBIN_ORDERS_BIN_ID  - jsonbin bin id for orders (the bin should contain {"orders": [...] } or an array)
  JSONBIN_MASTER_KEY     - your jsonbin Master Key (required to GET/PUT private bins)
  PORT (optional)        - port to run the server (default 3000)

How to use:
  1. Place server.js into your project root (replace existing server.js) OR run this adapter in the same folder as your frontend `public/`.
  2. Install deps: npm install
  3. Set env vars in Render (or local .env). Example:
     JSONBIN_ITEMS_BIN_ID=xxxxx
     JSONBIN_ORDERS_BIN_ID=yyyyy
     JSONBIN_MASTER_KEY=YOUR_MASTER_KEY
  4. Start: npm start

Notes:
  - On startup the server will try to GET from provided bins; if it can't, it will use local items.json and orders.json.
  - On every update the server will attempt to PUT the new content to jsonbin. If the PUT fails it will write locally.
  - The server expects jsonbin v3 API (https://api.jsonbin.io/v3/b/<binId>/latest and PUT to /v3/b/<binId>).
  - If your jsonbin configuration requires other headers (e.g. special collection id header), set them in the code (open server.js and adjust headers in jsonbinGet/jsonbinPut).

If you want, I can also:
  - Automatically create the bins in your collection via the API (requires Master Key) and return the created binIds.
  - Modify your current server in-place if you upload the project folder (so I can patch server.js directly).
