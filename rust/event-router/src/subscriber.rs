// ZMQ SUB socket for Frigate event topics.
// Connects to: ipc:///tmp/cache/proxy_sub
// Subscribe filter: "event/"
//
// Topics received:
//   event/update    → [EventTypeEnum, EventStateEnum, str|null, camera, data_dict]
//   event/finalized → [EventTypeEnum, EventStateEnum, event_id, data_dict]
