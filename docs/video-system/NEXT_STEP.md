# Video System — Out of Scope / Next Steps

## Out of Scope (Current Implementation)

- **Live stream fuzzy matching**: Live stream content_ids don't match video IDs. Would require title similarity or time overlap matching. Not implemented.
- **Materialized views**: video_overview_view is a regular view. For large datasets (>5K videos), consider materializing and refreshing on import.
- **Bulk review UI**: Mapping review currently shows read-only table. Confirm/Reject buttons require a separate client component.
- **Stage 2 bridge matching**: Planned but simplified — current implementation uses Stage 3a/3b instead.
- **Cross-user dedup**: Each user's video_master is isolated. No cross-account merging.
- **TikTok API integration**: All data is currently from manual imports (JSON scrape + xlsx). Direct API would eliminate the scrape dependency.

## Known Limitations

- Stage 3b heuristic can produce false positives if multiple videos promoted the same product in the same month.
- `video_overview_view` is not paginated at the DB level — queries all rows per user.
- `content_order_facts.import_batch_id` is used to scope per-batch sync, but very old batches before migration-094 may not have this.

## Recommended Next Steps

1. Add Confirm/Reject buttons to the mapping review page (client component with server actions)
2. Add pagination or virtual scrolling to the video overview table for users with >1000 videos
3. Add "Run Full Sync" button on the video overview page that calls `triggerFullSync()`
4. Monitor `video_source_mapping` WHERE match_status IN ('needs_review', 'conflict') after each import
