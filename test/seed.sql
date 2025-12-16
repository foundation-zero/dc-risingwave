DROP TABLE IF EXISTS primitive_types;
CREATE TABLE primitive_types (
  id INTEGER PRIMARY KEY,
  name VARCHAR,
  age INTEGER,
  score FLOAT,
  is_active BOOLEAN
);

INSERT INTO primitive_types (id, name, age, score, is_active) VALUES
  (1, 'Alice', 30, 85.5, TRUE),
  (2, 'Bob', 25, 90.0, FALSE);

DROP TABLE IF EXISTS single_nesting;
CREATE TABLE single_nesting (
  id INTEGER PRIMARY KEY,
  data STRUCT<
    name VARCHAR,
    number INTEGER
  >
);

INSERT INTO single_nesting (id, data) VALUES
  (1, ROW('Alice', 42)),
  (2, ROW('Bob', 7));

DROP TABLE IF EXISTS double_nesting;
CREATE TABLE double_nesting (
  id INTEGER PRIMARY KEY,
  data STRUCT<
    info STRUCT<
      description VARCHAR,
      value FLOAT
    >
  >
);

INSERT INTO double_nesting (id, data) VALUES
  (1, ROW(ROW('Test 1', 3.14))),
  (2, ROW(ROW('Test 2', 2.71)));

DROP TABLE IF EXISTS array_of_objects;
CREATE TABLE array_of_objects (
  id INTEGER PRIMARY KEY,
  items STRUCT<
    a INTEGER,
    b INTEGER
  >[]
);

INSERT INTO array_of_objects (id, items) VALUES
  (1, ARRAY[ROW(1, 2), ROW(3, 4)]),
  (2, ARRAY[ROW(5, 6), ROW(7, 8)]);

DROP TABLE IF EXISTS outgoing_relation;
CREATE TABLE outgoing_relation (
  id INTEGER PRIMARY KEY,
  other_id INTEGER
);

INSERT INTO outgoing_relation (id, other_id) VALUES
  (1, 10),
  (2, 20);

DROP TABLE IF EXISTS incoming_relation;
CREATE TABLE incoming_relation (
  id INTEGER PRIMARY KEY,
  name VARCHAR
);

INSERT INTO incoming_relation (id, name) VALUES
  (10, 'Related A'),
  (20, 'Related B');

CREATE MATERIALIZED VIEW IF NOT EXISTS view_outgoing_relation AS
SELECT * FROM outgoing_relation;
