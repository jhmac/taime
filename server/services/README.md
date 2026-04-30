# server/services/

This directory contains **modules with internal state, I/O, or lifecycle concerns**. Files here may maintain in-memory caches, hold initialized flags, schedule cron jobs, query the database, or call external APIs. Appropriate residents include: notification delivery, email dispatch, cron schedulers, credential stores, broadcast orchestration, store/location resolvers, and startup migration runners. If a file you are adding is a pure, stateless utility with no side effects, it belongs in `server/lib/` instead.
