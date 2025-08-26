
Orbit Store - remote JSON adapter (backend helper)
-------------------------------------------------

What this archive contains
- server.js  - Express server that reads/writes items and orders. If REMOTE_* env vars are set it uses those remote URLs.
- package.json - dependencies.

How to use
1) Replace your server.js with this file (or merge logic into your existing server.js).
2) Install dependencies:
   npm install
3) Configure environment variables for your Render service (or local):
   - REMOTE_ITEMS_URL   (e.g. https://api.example.com/bins/abcd/items)
   - REMOTE_ORDERS_URL  (e.g. https://api.example.com/bins/abcd/orders)
   - REMOTE_API_KEY     (optional token if your remote requires auth)
If REMOTE_* are not set, the server will continue to use local items.json and orders.json files.
Behavior
- On startup the server tries to GET remote items/orders and will use them if successful.
- When changing items/orders (add/update/delete/order/approve/reject/cancel), the server attempts to save to remote via PUT (falls back to POST), and if remote write fails it saves locally.
Important notes
- Different JSON hosting providers have different APIs (some require POST to update, some require special headers). Use the REMOTE_* variables to point to the correct endpoints and add REMOTE_API_KEY if needed.
- Keep a local backup items.json and orders.json in the project root before switching.
