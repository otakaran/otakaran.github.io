// Permanent redirect from www.otakar.dev to the apex, preserving path and query.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = "otakar.dev";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  },
};
