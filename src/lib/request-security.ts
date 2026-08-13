export function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const forwardedHost = request.headers
      .get("x-forwarded-host")
      ?.split(",")[0]
      ?.trim();
    const requestUrl = new URL(request.url);
    const expectedHost = forwardedHost || request.headers.get("host") || requestUrl.host;
    const forwardedProtocol = request.headers
      .get("x-forwarded-proto")
      ?.split(",")[0]
      ?.trim();
    const expectedProtocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : requestUrl.protocol;

    return (
      originUrl.host.toLowerCase() === expectedHost.toLowerCase() &&
      originUrl.protocol === expectedProtocol
    );
  } catch {
    return false;
  }
}
