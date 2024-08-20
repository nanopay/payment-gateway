export async function UnauthorizedException() {
	return new Response(
		JSON.stringify({
			message: 'Unauthorized',
		}),
		{
			status: 401,
			statusText: 'Unauthorized',
			headers: {
				'Content-Type': 'application/json',
			},
		}
	);
}

export async function NotFoundException() {
	return new Response(
		JSON.stringify({
			message: 'Not Found',
		}),
		{
			status: 404,
			statusText: 'Bad Request',
			headers: {
				'Content-Type': 'application/json',
			},
		}
	);
}

export async function BadRequestException(message: string) {
	return new Response(
		JSON.stringify({
			message,
		}),
		{
			status: 400,
			statusText: 'Bad Request',
			headers: {
				'Content-Type': 'application/json',
			},
		}
	);
}

export async function ServerException(message: string) {
	return new Response(
		JSON.stringify({
			message,
		}),
		{
			status: 500,
			statusText: 'Internal Server Error',
			headers: {
				'Content-Type': 'application/json',
			},
		}
	);
}

export async function SuccessResponse(data: Record<string, any>) {
	return new Response(JSON.stringify(data), {
		status: 200,
		statusText: 'OK',
		headers: {
			'Content-Type': 'application/json',
		},
	});
}
