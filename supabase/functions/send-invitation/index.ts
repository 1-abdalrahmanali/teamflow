// Entry point Supabase runs. The logic lives in handler.ts so it can be tested directly.
import { handleInvitation } from './handler.ts';

Deno.serve(handleInvitation);
