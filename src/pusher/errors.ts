
/** Contains information about an HTTP request error.
 *
 * @constructor
 * @extends Error
 * @param {String} message error message
 * @param {String} url request URL
 * @param [error] optional error cause
 * @param {Integer} [status] response status code, if received
 * @param {String} [body] response body, if received
 */
export class RequestError extends Error {
    name = "PusherRequestError"
    url: string
    error: any
    status: number | undefined
    body: any

    constructor(message: string, url: string, error: any, status?: number | undefined, body?: any) {
        super(message)
        this.url = url
        this.error = error
        this.status = status
        this.body = body
    }
}