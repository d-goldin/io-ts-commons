// eslint-disable @typescript-eslint/no-explicit-any

import {
  IRequestMiddleware,
  withRequestMiddlewares
} from "../request_middleware";
import {
  IResponse,
  IResponseErrorValidation,
  ResponseErrorValidation
} from "../responses";

import { left, right } from "fp-ts/lib/Either";
import { number } from "fp-ts";

const ResolvingMiddleware: IRequestMiddleware<
  "IResponseErrorNever",
  string
> = req => {
  return Promise.resolve(right<never, string>(req.params.dummy));
};

const ResolvingNumberMiddleware: IRequestMiddleware<
  "IResponseErrorNever",
  number
> = req => {
  return Promise.resolve(right<never, number>(1));
};

const RejectingMiddleware: IRequestMiddleware<
  "IResponseErrorValidation",
  string
> = _ => {
  return Promise.resolve(
    left<IResponseErrorValidation, string>(
      ResponseErrorValidation("NOK", "NOT")
    )
  );
};

const request = {
  params: {
    dummy: "dummy"
  }
};

const response = {} as IResponse<{}>;

describe("withRequestMiddlewares", () => {
  // one case for any number of supported middlewares
  const cases = [1, 5, 10, 100];
  it.each(cases)(
    "should process a request with %i resolving middlewares",
    n => {
      const mockHandler = jest.fn(() => Promise.resolve(response));

      const middlewares = Array(n).fill(ResolvingMiddleware);
      const expected = Array(n).fill("dummy");

      const handler = withRequestMiddlewares(...middlewares)(mockHandler);

      return handler(request as any).then((r: any) => {
        expect(mockHandler).toHaveBeenCalledWith(...expected);
        expect(r).toEqual(response);
      });
    }
  );

  it.each(cases)(
    "should process a request with %i middlewares whose last one rejects",
    n => {
      const mockHandler = jest.fn(() => Promise.resolve(response));

      // Provide a series of resolving middlewares followed by a rejecting one
      //   by providing the rejecting middleware at last, we ensure it's actually executed and its result matters
      const middlewares = [
        ...Array(n - 1).fill(ResolvingMiddleware),
        RejectingMiddleware
      ];

      const handler = withRequestMiddlewares(...middlewares)(mockHandler);

      return handler(request as any).then((r: any) => {
        expect(mockHandler).not.toHaveBeenCalled();
        expect(r.kind).toBe("IResponseErrorValidation");
      });
    }
  );

  it("should accept handler with right parameters", () => {
    const mockHandler: (
      param1: string,
      param2: number
    ) => Promise<IResponse<{}>> = jest.fn((param1, param2) =>
      Promise.resolve(response)
    );

    const handler = withRequestMiddlewares(
      ResolvingMiddleware,
      ResolvingNumberMiddleware
    )(mockHandler);

    return handler(request as any).then(r => {
      expect(mockHandler).toHaveBeenCalledWith(...["dummy", 1]);
      expect(r).toEqual(response);
    });
  });

  it("should NOT accept handler with type mismatching parameters", () => {
    const mockHandler: (
      param1: string,
      param2: string
    ) => Promise<IResponse<{}>> = jest.fn(() => Promise.resolve(response));

    const handler = withRequestMiddlewares(
      ResolvingMiddleware,
      ResolvingNumberMiddleware
      // @ts-expect-error
    )(mockHandler);
  });

  it("should NOT accept handler with more parameters than middlewares", () => {
    const mockHandler: (
      param1: string,
      param2: number,
      param3: number
    ) => Promise<IResponse<{}>> = jest.fn(() => Promise.resolve(response));

    const handler = withRequestMiddlewares(
      ResolvingMiddleware,
      ResolvingNumberMiddleware
      // @ts-expect-error
    )(mockHandler);
  });

  it("should process a request with a rejecting middleware", () => {
    const mockHandler = jest.fn(() => Promise.resolve(response));
    const handler = withRequestMiddlewares(RejectingMiddleware)(mockHandler);

    return handler(request as any).then(r => {
      expect(mockHandler).not.toHaveBeenCalled();
      expect(r.kind).toBe("IResponseErrorValidation");
    });
  });

  it("should stop processing middlewares after a rejecting middleware", () => {
    const mockHandler = jest.fn(() => Promise.resolve(response));
    const handler = withRequestMiddlewares(
      RejectingMiddleware,
      ResolvingMiddleware
    )(mockHandler);

    return handler(request as any).then(r => {
      expect(mockHandler).not.toHaveBeenCalled();
      expect(r.kind).toBe("IResponseErrorValidation");
    });
  });
});
