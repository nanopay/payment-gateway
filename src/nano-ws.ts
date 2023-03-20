import { Payment } from "./types";
import { rawToNano, sleep } from "./utils";

async function subscribe(wsUrl: string, account: string) {
    // Make a fetch request including `Upgrade: websocket` header.
    // The Workers Runtime will automatically handle other requirements
    // of the WebSocket protocol, like the Sec-WebSocket-Key header.
    let resp = await fetch(wsUrl, {
        headers: {
            Upgrade: 'websocket',
        },
    });

    // If the WebSocket handshake completed successfully, then the
    // response has a `webSocket` property.
    let ws = resp.webSocket;
    if (!ws) {
        throw new Error("server didn't accept WebSocket");
    }

    // Call accept() to indicate that you'll be handling the socket here
    // in JavaScript, as opposed to returning it on to a client.
    ws.accept();

    const confirmation_subscription = {
        "action": "subscribe",
        "topic": "confirmation",
        "options": {
            "all_local_accounts": true,
            "accounts": [account]
          }
    }

    // Now you can send and receive messages like before.
    ws.send(JSON.stringify(confirmation_subscription));

    return ws;
}

export async function waitForPayment(wsUrl: string, account: string, timeout: number): Promise<Payment> {
    return new Promise(async (resolve, reject) => {
        try {
            const ws = await subscribe(wsUrl, account);
            ws.addEventListener('message', msg => {
                const data = JSON.parse(msg.data as string);
                if (data.message?.block?.subtype === 'send') {
                    (ws as WebSocket).close();
                    return resolve({
                        from: data.message.block.account,
                        amount: rawToNano(data.message.amount),
                        hash: data.message.hash,
                        to: data.message.block.link_as_account,
                        timestamp: Number(data.time)
                    });
                }
            });
            sleep(timeout).then(() => {
                (ws as WebSocket).close();
                reject(new Error("PaymentTimeout"));
            });
        } catch (err) {
            reject(err);
        }
    })
}

