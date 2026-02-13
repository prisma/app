# Glossary (ubiquitous language)

This glossary defines the shared terms used across the design docs.

## App

A named container for a set of resources and executables and their wiring (topology).

## Descriptor

A control-plane, statically analyzable definition of a resource/executable/component (pure metadata + references to artifacts).

## Resource

A provisioned platform primitive (e.g. Prisma Postgres, Durable Stream, File Storage bucket).

## Executable / Service

Something that runs on compute (e.g. an HTTP service, worker, stream consumer).

## Binding

An explicit dependency edge between nodes (service → resource, ingress → service) that also drives runtime dependency injection.

## Ingress

A node representing external connectivity into the app (e.g. public HTTP). Ingress is not discovered via globals; it is wired in the topology and provided as a system binding at runtime.

## Entrypoint

An addressable unit the platform can execute (by id/kind), defined by an artifact reference plus declared required bindings.

## Control plane

MakerKit mode for importing descriptors, validating/normalizing, building topology, emitting manifests/artifacts, and driving provisioning/inspection.

## Execution plane

MakerKit mode for instantiating implementations, satisfying the dependency graph, performing DI, and running entrypoints.

## Durable Stream

The streaming backbone primitive (log/topic) used for service-to-service, DB-to-service, and service-to-client communication.
