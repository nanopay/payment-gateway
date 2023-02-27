export async function UnauthorizedException(reason: string) {
    return new Response(JSON.stringify({
        reason
    }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: {
            'Content-Type': 'application/json'
        }
    });
}

export async function BadRequestException(reason: string) {
    return new Response(JSON.stringify({
        reason
    }), {
        status: 400,
        statusText: 'Bad Request',
        headers: {
            'Content-Type': 'application/json'
        }
    });
}

export async function SuccessResponse(data: Record<string, any>) {
    return new Response(JSON.stringify(data), {
        status: 200,
        statusText: 'OK',
        headers: {
            'Content-Type': 'application/json'
        }
    });
}

