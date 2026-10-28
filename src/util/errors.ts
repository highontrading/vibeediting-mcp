/** An error whose message is written for the end user: what went wrong and what to do next. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof UserError) return err.message;
  if (err instanceof Error) return `Something went wrong: ${err.message}`;
  return `Something went wrong: ${String(err)}`;
}
