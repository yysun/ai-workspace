CREATE TABLE aiw_documents (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    workspace_id NVARCHAR(128) NOT NULL,
    user_id NVARCHAR(128) NOT NULL,
    path NVARCHAR(1000) NOT NULL,
    object_type NVARCHAR(100) NULL,
    object_id NVARCHAR(200) NULL,
    layer NVARCHAR(100) NULL,
    title NVARCHAR(500) NULL,
    content NVARCHAR(MAX) NOT NULL,
    content_type NVARCHAR(100) NOT NULL DEFAULT 'text/markdown',
    metadata_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    deleted_at DATETIME2 NULL,
    CONSTRAINT uq_aiw_documents_scope_path UNIQUE (workspace_id, user_id, path)
);
GO

CREATE INDEX ix_aiw_documents_object
ON aiw_documents (workspace_id, user_id, object_type, object_id)
INCLUDE (path, layer, title, updated_at)
WHERE deleted_at IS NULL;
GO

CREATE INDEX ix_aiw_documents_layer
ON aiw_documents (workspace_id, user_id, layer, updated_at DESC)
INCLUDE (path, object_type, object_id, title)
WHERE deleted_at IS NULL;
GO

CREATE INDEX ix_aiw_documents_path
ON aiw_documents (workspace_id, user_id, path)
WHERE deleted_at IS NULL;
GO

CREATE TABLE aiw_document_versions (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    document_id UNIQUEIDENTIFIER NOT NULL,
    workspace_id NVARCHAR(128) NOT NULL,
    user_id NVARCHAR(128) NOT NULL,
    version_number INT NOT NULL,
    content NVARCHAR(MAX) NOT NULL,
    metadata_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    created_by NVARCHAR(128) NULL,
    CONSTRAINT fk_aiw_document_versions_document FOREIGN KEY (document_id) REFERENCES aiw_documents(id)
);
GO

CREATE TABLE aiw_objects (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    workspace_id NVARCHAR(128) NOT NULL,
    user_id NVARCHAR(128) NOT NULL,
    object_type NVARCHAR(100) NOT NULL,
    object_id NVARCHAR(200) NOT NULL,
    display_name NVARCHAR(500) NOT NULL,
    normalized_name NVARCHAR(500) NOT NULL,
    source_system NVARCHAR(100) NULL,
    source_ref NVARCHAR(500) NULL,
    metadata_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    deleted_at DATETIME2 NULL,
    CONSTRAINT uq_aiw_objects UNIQUE (workspace_id, user_id, object_type, object_id)
);
GO

CREATE INDEX ix_aiw_objects_name
ON aiw_objects (workspace_id, user_id, normalized_name)
INCLUDE (object_type, object_id, display_name)
WHERE deleted_at IS NULL;
GO

CREATE TABLE aiw_object_aliases (
    id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    workspace_id NVARCHAR(128) NOT NULL,
    user_id NVARCHAR(128) NOT NULL,
    object_type NVARCHAR(100) NOT NULL,
    object_id NVARCHAR(200) NOT NULL,
    alias NVARCHAR(500) NOT NULL,
    normalized_alias NVARCHAR(500) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE INDEX ix_aiw_object_aliases
ON aiw_object_aliases (workspace_id, user_id, normalized_alias)
INCLUDE (object_type, object_id, alias);
GO

-- Optional seed example:
-- INSERT INTO aiw_objects (workspace_id, user_id, object_type, object_id, display_name, normalized_name)
-- VALUES ('local', 'user-1', 'contact', 'c9821', 'Jazz Gill', 'jazz gill');
