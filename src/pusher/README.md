# Pusher Send for EDGE
An unofficial implementation of pusher using its REST API.

Part of the code was adapted from pusher-http-node (for node.js):
https://github.com/pusher/pusher-http-node/blob/master/lib/requests.js


Some crypto utilities have been made compatible with edge computing.

- md5: Build with `CryptoJS`
- createHmac: `crypto.subtle.importKey` and `crypto.subtle.sign`

### Usage

```js
pusherSend({
    data: { message: 'Hello from EDGE' },
	name: 'my-event',
	channel: 'my-channel',
	config: {
	    appId: env.PUSHER_APP_ID,
		key: env.PUSHER_KEY,
		secret: env.PUSHER_SECRET
	}
});
```