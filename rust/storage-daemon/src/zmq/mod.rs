// ZMQ communication layer for storage-daemon.
//
// Sockets used:
//   ipc_client  — REQ socket to ipc:///tmp/cache/comms  (INSERT_MANY_RECORDINGS etc.)
//   pubsub      — PUB to proxy_pub, SUB from proxy_sub  (detection/ and recordings/ topics)

pub mod ipc_client;
pub mod pubsub;
