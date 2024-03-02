import { createClient } from "@supabase/supabase-js";
import { Database, Environment } from "../types";
import { NotFoundException, ServerException, SuccessResponse } from "../responses";

export const getInvoice = async (request: Request, env: Environment) => {
    const url = new URL(request.url);
    const id = url.pathname.split("/invoices/").pop();

    const supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_KEY);

    const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .eq("id", id)
        .single();

    if (error) {
        if (error.code === "PGRST116") {
            return NotFoundException();
        } 
        return ServerException(error.message);
    }

    if (!data) {
        return NotFoundException();
    }

    return SuccessResponse(data);
}