import { startTransition, type FormEvent } from "react";

/**
 * `onSubmit` for a `useActionState` form. React 19 resets every uncontrolled
 * field after a `<form action>` submit, so a server-side error used to wipe
 * what the user typed; dispatching manually skips that reset.
 */
export function submitWithoutReset(action: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Passing the submitter keeps a clicked button's name/value, as a native submit would.
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    startTransition(() => action(data));
  };
}
