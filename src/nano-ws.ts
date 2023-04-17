import { Payment } from "./types";
import { rawToNano } from "./utils";

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

            let isClosed = false;
            let timeoutId: any;

            const close = () => {
                isClosed = true;
                ws.close();
                if (timeoutId) {
                    clearInterval(timeoutId)
                }
            }

            const handleClose = () => {
                if (!isClosed) {
                    reject(new Error("WebSocketClosed"));
                }
            }

            const handlePayment = (msg: MessageEvent) => {
                const data = JSON.parse(msg.data as string);
                if (data.message?.block?.subtype === 'send') {
                    close();
                    resolve({
                        from: data.message.block.account,
                        amount: rawToNano(data.message.amount),
                        hash: data.message.hash,
                        to: data.message.block.link_as_account,
                        timestamp: Number(data.time)
                    });
                }
            }

            const ws = await subscribe(wsUrl, account);

            ws.addEventListener('message', handlePayment);
            ws.addEventListener('close', handleClose);

            timeoutId = setTimeout(() => {
                close();
                reject(new Error("PaymentTimeout"));
            }, timeout)

        } catch (err) {
            reject(err);
        }
    })
}

