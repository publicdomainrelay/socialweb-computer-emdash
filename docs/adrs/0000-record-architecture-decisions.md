# 0000. Record architecture decisions

Status: accepted

## Context

This repository is an EmDash site plus sandboxed plugins. Each plugin connects the site to AT Protocol lexicons owned by other apps. Choices about OAuth, scopes and sandbox limits need a record so reviewers can see why the code looks the way it does.

## Decision

Record each significant decision as a numbered Markdown file in `docs/adrs/`, named `NNNN-short-concept.md`, with Status, Context, Decision and Consequences sections.

## Consequences

The code itself carries no comments. Rationale lives in these ADRs, and the README stays minimal and runnable.
