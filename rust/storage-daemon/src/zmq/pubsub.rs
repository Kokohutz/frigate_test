// ZMQ PUB/SUB via the Frigate proxy.
//
// Publishers connect to SOCKET_PUB = ipc:///tmp/cache/proxy_pub
// Subscribers connect to SOCKET_SUB = ipc:///tmp/cache/proxy_sub
//
// Message format (zmq_proxy.py Publisher.publish):
//   f"{topic}{sub_topic} {json.dumps(payload)}"
//
// On receive, split on first space: parts = msg.split(maxsplit=1)
