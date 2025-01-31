/**
 * Helpers for dealing with fetch requests
 */

import { TaskEither, tryCatch } from "fp-ts/lib/TaskEither";
import * as E from "fp-ts/lib/Either";
import { pipe } from "fp-ts/lib/function";
import { timeoutPromise } from "./promises";
import {
  MaxRetries,
  RetriableTask,
  RetryAborted,
  TransientError
} from "./tasks";
import { ITuple2, Tuple2 } from "./tuples";
import { Millisecond } from "./units";

// eslint-disable-next-line import/no-internal-modules
import "abort-controller/polyfill";

/**
 * An instance of fetch, along its associated AbortController
 */
export type AbortableFetch = (
  input: Request | string,
  init?: RequestInit
) => ITuple2<Promise<Response>, AbortController>;

/**
 * Makes fetch abortable and returns an AbortableFetch.
 *
 * The fetch request can be aborted by calling `AbortController`'s `abort()`.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort
 */
// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function AbortableFetch(
  origFetch: typeof fetch = fetch
): AbortableFetch {
  // a fetch-like function that for each request, returns a tuple with the
  // response and the instance of the abortController associated to the request
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  return (input, init) => {
    // instantiate an abort controller
    const abortController = new AbortController();
    const signal = abortController.signal;

    // augment the provided fetch with the signal controller
    const newInit = {
      ...init,
      signal
    };

    // execute the request
    const response = origFetch(input, newInit);

    return Tuple2(response, abortController);
  };
}

/**
 * Converts an AbortableFetch back to a simple fetch
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const toFetch = (f: AbortableFetch) => (
  input: Request | string,
  init?: RequestInit
) => f(input, init).e1;

/**
 * Sets a timeout on an AbortableFetch.
 *
 * When the timeout expires, the controller's `abort()` method gets called.
 */
// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function setFetchTimeout(
  timeout: Millisecond,
  abortableFetch: AbortableFetch
): AbortableFetch {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  return (input, init) => {
    const result = abortableFetch(input, init);
    // abort the fetch request on timeout
    timeoutPromise(timeout)
      .then(() => {
        result.e2.abort();
      })
      .catch(_ => void 0);
    return result;
  };
}

/**
 * Given a function that wraps a RetriableTask with retries, it returns an
 * fetch that wraps the original fetch with retries on transient errors such
 * as network errors and timeouts.
 */
export const retriableFetch: (
  retryWrapper: (
    _: RetriableTask<Error, Response>,
    shouldAbort?: Promise<boolean>
  ) => TaskEither<Error | MaxRetries | RetryAborted, Response>,
  shouldAbort?: Promise<boolean>
) => (f: typeof fetch) => typeof fetch = (
  retryWrapper,
  shouldAbort = Promise.resolve(false)
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
) => f => (input: Request | string, init?: RequestInit) => {
  // wraps the fetch call with a TaskEither type, mapping certain promise
  // rejections to TransientError(s)
  const fetchTask = tryCatch<Error | TransientError, Response>(
    () => f(input, init),
    reason => {
      // map rejection reason to a transient or permanent error
      if (
        `${reason}`.toLowerCase().indexOf("aborted") >= 0 ||
        (reason as Error).name === "Aborted" ||
        (reason as Error).name === "Network request failed" ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (reason as any).type === "aborted"
      ) {
        // We return a TransientError in case the request got aborted by
        // a timeout or there was a network request.
        // See possible rejections of fetch here:
        // https://github.com/github/fetch/blob/master/fetch.js#L441
        // TODO: make this logic customizable (e.g. via response status)
        return TransientError;
      }

      // in all other case we return the reject reason
      // TODO: provide reason?
      return new Error("Promise has been rejected");
    }
  );

  // wrap the fetch task with the provided retry wrapper
  const fetchWithRetries = retryWrapper(fetchTask, shouldAbort);

  // return a new promise that gets resolved when the task resolves to a Right
  // or gets rejected in all other cases
  return new Promise<Response>((resolve, reject) => {
    fetchWithRetries().then(result => {
      pipe(result, E.fold(reject, resolve));
    }, reject);
  });
};
