// Hyper HTTP server on 127.0.0.1:5002.
// Serves encrypted .mp4 files with transparent range-request decryption.
// Nginx proxies read requests from the Frigate API to this server.
//
// Supports HTTP Range header: decrypt only the requested byte range.
// Response headers: Content-Type: video/mp4, Accept-Ranges: bytes.
