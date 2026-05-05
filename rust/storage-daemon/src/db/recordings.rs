// Recordings table queries.
// Schema (from frigate/models.py):
//   id VARCHAR(30) PK, camera VARCHAR(20), path VARCHAR(255) UNIQUE,
//   start_time DATETIME, end_time DATETIME, duration FLOAT,
//   motion INT, objects INT, dBFS INT, segment_size FLOAT,
//   regions INT, motion_heatmap JSON
