import { createClient } from '@supabase/supabase-js';
import { Database } from '../types';
import { NotFoundException, ServerException, SuccessResponse } from '../responses';

export const getInvoice = async (request: Request, env: Env) => {
	const url = new URL(request.url);
	const id = url.pathname.split('/invoices/').pop();

	if (!id) {
		return NotFoundException();
	}

	const supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);

	const { data, error } = await supabase
		.from('invoices')
		.select('*, service:services(id, slug, name, avatar_url, description, website, contact_email)')
		.eq('id', id)
		.single();

	if (error) {
		if (error.code === 'PGRST116') {
			return NotFoundException();
		}
		return ServerException(error.message);
	}

	if (!data) {
		return NotFoundException();
	}

	return SuccessResponse(data);
};
