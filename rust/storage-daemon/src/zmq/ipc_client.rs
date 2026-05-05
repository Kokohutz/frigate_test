// REQ socket client for ipc:///tmp/cache/comms.
//
// Wire protocol (inter_process.py):
//   send: socket.send_json(["topic_name", data])   — JSON 2-tuple
//   recv: socket.recv_json()                        — any JSON (must always recv)
//
// Reconnects on any error (ZMQ REQ state machine requires clean socket on failure).
