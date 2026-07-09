use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rand::{distributions::Alphanumeric, Rng, RngCore};
use redis::{
    aio::{ConnectionLike, ConnectionManager, MultiplexedConnection},
    cluster::ClusterClient,
    cluster_async::ClusterConnection,
    sentinel::{SentinelClient, SentinelNodeConnectionInfo, SentinelServerType},
    Cmd, FromRedisValue, Pipeline, RedisConnectionInfo, RedisFuture, RedisResult, TlsMode,
    Value as RedisValue,
};
use ring::{aead, digest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    sync::Mutex,
    time::{timeout, Duration},
};

const DEFAULT_SCAN_COUNT: usize = 200;
const FILTERED_SCAN_MAX_ITERATIONS: usize = 16;
const DEFAULT_PAGE_SIZE: usize = 100;
const MAX_VALUE_DISPLAY_SIZE: isize = 1024 * 1024;
const SAFE_KEYS_LIMIT: usize = 10_000;
const COMMAND_TIMEOUT_MS: u64 = 5_000;
const CLI_OUTPUT_MAX_BYTES: usize = 256 * 1024;
const CLI_ARRAY_MAX_ITEMS: usize = 1_000;
const CLI_FORMAT_MAX_DEPTH: usize = 8;
const CLI_COMPLETION_MAX_KEYS: usize = 50;
const CLI_COMPLETION_SCAN_MAX_ITERATIONS: usize = 12;
const CLI_COMPLETION_DEEP_PREFIX_MIN_CHARS: usize = 32;
const CLI_COMPLETION_DEEP_SCAN_COUNT: usize = 1_000;
const CLI_COMPLETION_DEEP_SCAN_MAX_ITERATIONS: usize = usize::MAX;
const BINARY_PREVIEW_BYTES: usize = 64 * 1024;
const KEYCHAIN_SERVICE: &str = "com.redix.desktop";
const FALLBACK_SECRET_ACCOUNT: &str = "password-fallback-secret";
const CONNECTION_STATUS_EVENT: &str = "connection-status-changed";
const DANGEROUS_COMMANDS: &[&str] = &[
    "FLUSHALL",
    "FLUSHDB",
    "CONFIG",
    "DEBUG",
    "SHUTDOWN",
    "SLAVEOF",
    "REPLICAOF",
    "MODULE",
];

type JsonResponse = Result<IpcResponse<Value>, String>;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConnectionConfig {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    host: String,
    port: u16,
    password: Option<String>,
    db: Option<u8>,
    tls: Option<bool>,
    sentinel_options: Option<SentinelOptions>,
    cluster_options: Option<ClusterOptions>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PublicConnectionConfig {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    host: String,
    port: u16,
    has_password: bool,
    db: Option<u8>,
    tls: Option<bool>,
    sentinel_options: Option<SentinelOptions>,
    cluster_options: Option<ClusterOptions>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HostPort {
    host: String,
    port: u16,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SentinelOptions {
    name: String,
    sentinels: Vec<HostPort>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClusterOptions {
    nodes: Vec<HostPort>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredConnection {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    host: String,
    port: u16,
    db: Option<u8>,
    tls: Option<bool>,
    has_password: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    password_encrypted: Option<String>,
    sentinel_options: Option<SentinelOptions>,
    cluster_options: Option<ClusterOptions>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct StoreFile {
    connections: Vec<StoredConnection>,
}

#[derive(Debug, Deserialize)]
struct LegacyStoreFile {
    connections: Vec<LegacyConnection>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyConnection {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    host: String,
    port: u16,
    db: Option<u8>,
    tls: Option<bool>,
    sentinel_options: Option<SentinelOptions>,
    cluster_options: Option<ClusterOptions>,
}

#[derive(Clone)]
struct ActiveConnection {
    client: RedisClient,
}

#[derive(Clone)]
enum RedisClient {
    Standalone(ConnectionManager),
    Sentinel(MultiplexedConnection),
    Cluster(ClusterConnection),
}

impl ConnectionLike for RedisClient {
    fn req_packed_command<'a>(&'a mut self, cmd: &'a Cmd) -> RedisFuture<'a, RedisValue> {
        match self {
            Self::Standalone(client) => client.req_packed_command(cmd),
            Self::Sentinel(client) => client.req_packed_command(cmd),
            Self::Cluster(client) => client.req_packed_command(cmd),
        }
    }

    fn req_packed_commands<'a>(
        &'a mut self,
        cmd: &'a Pipeline,
        offset: usize,
        count: usize,
    ) -> RedisFuture<'a, Vec<RedisValue>> {
        match self {
            Self::Standalone(client) => client.req_packed_commands(cmd, offset, count),
            Self::Sentinel(client) => client.req_packed_commands(cmd, offset, count),
            Self::Cluster(client) => client.req_packed_commands(cmd, offset, count),
        }
    }

    fn get_db(&self) -> i64 {
        match self {
            Self::Standalone(client) => client.get_db(),
            Self::Sentinel(client) => client.get_db(),
            Self::Cluster(client) => client.get_db(),
        }
    }
}

#[derive(Clone)]
struct ScanSession {
    cursor: u64,
    pattern: String,
    type_filter: Option<String>,
    exhausted: bool,
    connection_id: String,
    db: i64,
    total_scanned: usize,
}

struct Storage {
    path: PathBuf,
    data: StoreFile,
}

struct AppState {
    storage: Mutex<Storage>,
    connections: Mutex<HashMap<String, ActiveConnection>>,
    scans: Mutex<HashMap<String, ScanSession>>,
}

#[derive(Debug, Serialize)]
struct IpcError {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<String>,
}

#[derive(Debug, Serialize)]
struct IpcResponse<T: Serialize> {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<IpcError>,
}

#[derive(Debug, Serialize)]
struct TestResult {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct ConnectionStatusPayload {
    id: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn ok<T: Serialize>(data: T) -> JsonResponse {
    Ok(IpcResponse {
        success: true,
        data: Some(serde_json::to_value(data).unwrap_or(Value::Null)),
        error: None,
    })
}

fn ok_empty() -> JsonResponse {
    Ok(IpcResponse {
        success: true,
        data: None,
        error: None,
    })
}

fn fail(code: &str, message: &str, details: impl ToString) -> JsonResponse {
    Ok(IpcResponse {
        success: false,
        data: None,
        error: Some(IpcError {
            code: code.to_string(),
            message: message.to_string(),
            details: Some(details.to_string()),
        }),
    })
}

impl Storage {
    fn new(path: PathBuf) -> Self {
        let mut data: StoreFile = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let mut imported = false;
        if data.connections.is_empty() {
            data.connections = import_legacy_connections();
            imported = !data.connections.is_empty();
        }
        let storage = Self { path, data };
        if imported {
            let _ = storage.persist();
        }
        storage
    }

    fn get_connections(&self) -> Vec<PublicConnectionConfig> {
        self.data
            .connections
            .iter()
            .map(|stored| self.to_public_config(stored))
            .collect()
    }

    fn get_connection(&self, id: &str) -> Option<ConnectionConfig> {
        self.data
            .connections
            .iter()
            .find(|conn| conn.id == id)
            .map(|stored| self.to_config(stored))
    }

    fn add_connection(&mut self, config: &ConnectionConfig) -> Result<(), String> {
        if self
            .data
            .connections
            .iter()
            .any(|conn| conn.id == config.id)
        {
            return Err(format!(
                "Connection with id \"{}\" already exists",
                config.id
            ));
        }
        let stored = self.to_stored(config, None, false)?;
        if let Some(password) = config
            .password
            .as_deref()
            .filter(|password| !password.is_empty())
        {
            let _ = save_password(&config.id, password);
        }
        self.data.connections.push(stored);
        self.persist()
    }

    fn update_connection(&mut self, config: &ConnectionConfig) -> Result<(), String> {
        let index = self
            .data
            .connections
            .iter()
            .position(|conn| conn.id == config.id)
            .ok_or_else(|| format!("Connection with id \"{}\" not found", config.id))?;
        let previous = self.data.connections[index].clone();
        let stored = self.to_stored(
            config,
            previous.password_encrypted.as_deref(),
            previous.has_password,
        )?;
        if let Some(password) = config
            .password
            .as_deref()
            .filter(|password| !password.is_empty())
        {
            let _ = save_password(&config.id, password);
        }
        self.data.connections[index] = stored;
        self.persist()
    }

    fn delete_connection(&mut self, id: &str) -> Result<(), String> {
        let before = self.data.connections.len();
        self.data.connections.retain(|conn| conn.id != id);
        if self.data.connections.len() == before {
            return Err(format!("Connection with id \"{}\" not found", id));
        }
        let _ = delete_password(id);
        self.persist()
    }

    fn to_config(&self, stored: &StoredConnection) -> ConnectionConfig {
        ConnectionConfig {
            id: stored.id.clone(),
            name: stored.name.clone(),
            kind: stored.kind.clone(),
            host: stored.host.clone(),
            port: stored.port,
            password: if stored.has_password {
                get_password(&stored.id).ok().or_else(|| {
                    decrypt_password_fallback(&stored.id, stored.password_encrypted.as_deref()).ok()
                })
            } else {
                None
            },
            db: stored.db,
            tls: stored.tls,
            sentinel_options: stored.sentinel_options.clone(),
            cluster_options: stored.cluster_options.clone(),
        }
    }

    fn to_public_config(&self, stored: &StoredConnection) -> PublicConnectionConfig {
        PublicConnectionConfig {
            id: stored.id.clone(),
            name: stored.name.clone(),
            kind: stored.kind.clone(),
            host: stored.host.clone(),
            port: stored.port,
            has_password: stored.has_password,
            db: stored.db,
            tls: stored.tls,
            sentinel_options: stored.sentinel_options.clone(),
            cluster_options: stored.cluster_options.clone(),
        }
    }

    fn public_config_for(&self, id: &str) -> Option<PublicConnectionConfig> {
        self.data
            .connections
            .iter()
            .find(|conn| conn.id == id)
            .map(|stored| self.to_public_config(stored))
    }

    fn to_stored(
        &self,
        config: &ConnectionConfig,
        previous_password: Option<&str>,
        previous_has_password: bool,
    ) -> Result<StoredConnection, String> {
        let password_encrypted = match config.password.as_deref() {
            Some(password) if !password.is_empty() => {
                Some(encrypt_password_fallback(&config.id, password)?)
            }
            _ => previous_password.map(ToString::to_string),
        };
        let has_password = config
            .password
            .as_deref()
            .is_some_and(|password| !password.is_empty())
            || previous_has_password;

        Ok(StoredConnection {
            id: config.id.clone(),
            name: config.name.clone(),
            kind: config.kind.clone(),
            host: config.host.clone(),
            port: config.port,
            db: config.db,
            tls: config.tls,
            has_password,
            password_encrypted,
            sentinel_options: config.sentinel_options.clone(),
            cluster_options: config.cluster_options.clone(),
        })
    }

    fn persist(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let raw = serde_json::to_string_pretty(&self.data).map_err(|err| err.to_string())?;
        fs::write(&self.path, raw).map_err(|err| err.to_string())
    }
}

fn import_legacy_connections() -> Vec<StoredConnection> {
    legacy_store_paths()
        .into_iter()
        .find_map(|path| {
            fs::read_to_string(path)
                .ok()
                .and_then(|raw| serde_json::from_str::<LegacyStoreFile>(&raw).ok())
                .map(|store| {
                    store
                        .connections
                        .into_iter()
                        .map(|conn| StoredConnection {
                            id: conn.id,
                            name: conn.name,
                            kind: conn.kind,
                            host: conn.host,
                            port: conn.port,
                            db: conn.db,
                            tls: conn.tls,
                            has_password: false,
                            password_encrypted: None,
                            sentinel_options: conn.sentinel_options,
                            cluster_options: conn.cluster_options,
                        })
                        .collect::<Vec<_>>()
                })
        })
        .unwrap_or_default()
}

fn legacy_store_paths() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    [
        "Library/Application Support/Redix/config.json",
        "Library/Application Support/redix-app/config.json",
        "Library/Application Support/redix/config.json",
    ]
    .into_iter()
    .map(|suffix| home.join(suffix))
    .collect()
}

fn keychain_entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, &format!("connection:{id}:password"))
        .map_err(|err| err.to_string())
}

fn fallback_secret_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, FALLBACK_SECRET_ACCOUNT).map_err(|err| err.to_string())
}

fn save_password(id: &str, password: &str) -> Result<(), String> {
    keychain_entry(id)?
        .set_password(password)
        .map_err(|err| err.to_string())
}

fn get_password(id: &str) -> Result<String, String> {
    keychain_entry(id)?
        .get_password()
        .map_err(|err| err.to_string())
}

fn delete_password(id: &str) -> Result<(), String> {
    keychain_entry(id)?
        .delete_credential()
        .map_err(|err| err.to_string())
}

fn get_or_create_fallback_secret() -> Result<String, String> {
    let entry = fallback_secret_entry()?;
    if let Ok(secret) = entry.get_password() {
        if !secret.is_empty() {
            return Ok(secret);
        }
    }

    let mut secret_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut secret_bytes);
    let secret = BASE64.encode(secret_bytes);
    entry.set_password(&secret).map_err(|err| err.to_string())?;
    Ok(secret)
}

fn fallback_password_key(id: &str, secret: &str) -> [u8; 32] {
    let material = format!("{KEYCHAIN_SERVICE}:{id}:password-fallback:v2:{secret}");
    let digest = digest::digest(&digest::SHA256, material.as_bytes());
    let mut key = [0u8; 32];
    key.copy_from_slice(digest.as_ref());
    key
}

fn legacy_fallback_password_key(id: &str) -> [u8; 32] {
    let material = format!("{KEYCHAIN_SERVICE}:{id}:password-fallback");
    let digest = digest::digest(&digest::SHA256, material.as_bytes());
    let mut key = [0u8; 32];
    key.copy_from_slice(digest.as_ref());
    key
}

fn encrypt_password_fallback(id: &str, password: &str) -> Result<String, String> {
    let secret = get_or_create_fallback_secret()?;
    let key_bytes = fallback_password_key(id, &secret);
    let unbound_key = aead::UnboundKey::new(&aead::AES_256_GCM, &key_bytes)
        .map_err(|_| "Failed to initialize password encryption".to_string())?;
    let key = aead::LessSafeKey::new(unbound_key);
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);
    let mut encrypted = password.as_bytes().to_vec();
    key.seal_in_place_append_tag(nonce, aead::Aad::from(id.as_bytes()), &mut encrypted)
        .map_err(|_| "Failed to encrypt password".to_string())?;
    Ok(format!(
        "v2:{}:{}",
        BASE64.encode(nonce_bytes),
        BASE64.encode(encrypted)
    ))
}

fn decrypt_password_fallback(id: &str, encrypted: Option<&str>) -> Result<String, String> {
    let encrypted = encrypted.ok_or_else(|| "No encrypted password fallback".to_string())?;
    let parts: Vec<&str> = encrypted.split(':').collect();
    if parts.len() != 3 || !matches!(parts[0], "v1" | "v2") {
        return Err("Unsupported encrypted password format".to_string());
    }

    let nonce_bytes: [u8; 12] = BASE64
        .decode(parts[1])
        .map_err(|err| err.to_string())?
        .try_into()
        .map_err(|_| "Invalid encrypted password nonce".to_string())?;
    let mut encrypted_bytes = BASE64.decode(parts[2]).map_err(|err| err.to_string())?;
    let key_bytes = if parts[0] == "v2" {
        let secret = fallback_secret_entry()
            .and_then(|entry| entry.get_password().map_err(|err| err.to_string()))?;
        fallback_password_key(id, &secret)
    } else {
        legacy_fallback_password_key(id)
    };
    let unbound_key = aead::UnboundKey::new(&aead::AES_256_GCM, &key_bytes)
        .map_err(|_| "Failed to initialize password decryption".to_string())?;
    let key = aead::LessSafeKey::new(unbound_key);
    let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes);
    let decrypted = key
        .open_in_place(nonce, aead::Aad::from(id.as_bytes()), &mut encrypted_bytes)
        .map_err(|_| "Failed to decrypt password".to_string())?;
    String::from_utf8(decrypted.to_vec()).map_err(|err| err.to_string())
}

async fn create_client(config: &ConnectionConfig) -> Result<RedisClient, String> {
    match config.kind.as_str() {
        "standalone" => create_standalone_client(config).await,
        "sentinel" => create_sentinel_client(config).await,
        "cluster" => create_cluster_client(config).await,
        other => Err(format!("Unsupported connection type: {other}")),
    }
}

async fn create_standalone_client(config: &ConnectionConfig) -> Result<RedisClient, String> {
    let db = config.db.unwrap_or(0);
    let url = redis_url(
        &config.host,
        config.port,
        config.password.as_deref(),
        config.tls.unwrap_or(false),
        Some(db),
    );
    let client = redis::Client::open(url).map_err(|err| err.to_string())?;
    match timeout(
        Duration::from_millis(COMMAND_TIMEOUT_MS),
        ConnectionManager::new(client),
    )
    .await
    {
        Ok(result) => result
            .map(RedisClient::Standalone)
            .map_err(classify_redis_error),
        Err(_) => Err("Connection timeout: Redis server did not respond in time".to_string()),
    }
}

async fn create_sentinel_client(config: &ConnectionConfig) -> Result<RedisClient, String> {
    let Some(options) = config.sentinel_options.as_ref() else {
        return Err("Sentinel options are required for sentinel connection type".to_string());
    };
    if options.name.trim().is_empty() {
        return Err("Sentinel master name is required".to_string());
    }
    if options.sentinels.is_empty() {
        return Err("At least one sentinel node is required".to_string());
    }

    let sentinel_nodes: Vec<String> = options
        .sentinels
        .iter()
        .map(|node| {
            redis_url(
                &node.host,
                node.port,
                None,
                config.tls.unwrap_or(false),
                None,
            )
        })
        .collect();
    let node_info = SentinelNodeConnectionInfo {
        tls_mode: config.tls.unwrap_or(false).then_some(TlsMode::Secure),
        redis_connection_info: Some(RedisConnectionInfo {
            db: i64::from(config.db.unwrap_or(0)),
            username: None,
            password: config
                .password
                .as_deref()
                .filter(|password| !password.is_empty())
                .map(ToString::to_string),
            ..Default::default()
        }),
    };
    let mut client = SentinelClient::build(
        sentinel_nodes,
        options.name.clone(),
        Some(node_info),
        SentinelServerType::Master,
    )
    .map_err(classify_redis_error)?;

    match timeout(
        Duration::from_millis(COMMAND_TIMEOUT_MS),
        client.get_async_connection(),
    )
    .await
    {
        Ok(result) => result
            .map(RedisClient::Sentinel)
            .map_err(classify_redis_error),
        Err(_) => Err("Connection timeout: Redis sentinel did not respond in time".to_string()),
    }
}

async fn create_cluster_client(config: &ConnectionConfig) -> Result<RedisClient, String> {
    let Some(options) = config.cluster_options.as_ref() else {
        return Err("Cluster options are required for cluster connection type".to_string());
    };
    if options.nodes.is_empty() {
        return Err("At least one cluster node is required".to_string());
    }

    let nodes: Vec<String> = options
        .nodes
        .iter()
        .map(|node| {
            redis_url(
                &node.host,
                node.port,
                None,
                config.tls.unwrap_or(false),
                None,
            )
        })
        .collect();
    let mut builder = ClusterClient::builder(nodes)
        .retries(3)
        .connection_timeout(Duration::from_millis(COMMAND_TIMEOUT_MS))
        .response_timeout(Duration::from_millis(COMMAND_TIMEOUT_MS));
    if let Some(password) = config
        .password
        .as_deref()
        .filter(|password| !password.is_empty())
    {
        builder = builder.password(password.to_string());
    }
    if config.tls.unwrap_or(false) {
        builder = builder.tls(TlsMode::Secure);
    }
    let client = builder.build().map_err(classify_redis_error)?;
    match timeout(
        Duration::from_millis(COMMAND_TIMEOUT_MS),
        client.get_async_connection(),
    )
    .await
    {
        Ok(result) => result
            .map(RedisClient::Cluster)
            .map_err(classify_redis_error),
        Err(_) => Err("Connection timeout: Redis cluster did not respond in time".to_string()),
    }
}

fn redis_url(host: &str, port: u16, password: Option<&str>, tls: bool, db: Option<u8>) -> String {
    let scheme = if tls { "rediss" } else { "redis" };
    let auth = password
        .filter(|password| !password.is_empty())
        .map(|password| format!(":{}@", urlencoding::encode(password)))
        .unwrap_or_default();
    let db_suffix = db.map(|db| format!("/{db}")).unwrap_or_default();
    format!("{scheme}://{auth}{host}:{port}{db_suffix}")
}

fn classify_redis_error(err: redis::RedisError) -> String {
    let message = err.to_string();
    if message.contains("Connection refused") || message.contains("os error 61") {
        return "Connection refused: Redis server is not running or unreachable".to_string();
    }
    if message.contains("timed out") {
        return "Connection timeout: Redis server did not respond in time".to_string();
    }
    if message.contains("WRONGPASS") {
        return "Authentication failed: invalid password".to_string();
    }
    if message.contains("NOAUTH") {
        return "Authentication required: password is needed".to_string();
    }
    message
}

async fn get_client(state: &AppState, connection_id: &str) -> Result<RedisClient, String> {
    let connections = state.connections.lock().await;
    connections
        .get(connection_id)
        .map(|conn| conn.client.clone())
        .ok_or_else(|| {
            format!(
                "Connection \"{}\" not found or not connected",
                connection_id
            )
        })
}

/// Ensure the shared connection points at `db` before running commands on it.
/// Redis Cluster has no logical databases and does not support SELECT, so it is
/// left untouched.
async fn select_db(client: &mut RedisClient, db: i64) -> Result<(), String> {
    if matches!(client, RedisClient::Cluster(_)) {
        return Ok(());
    }
    redis::cmd("SELECT")
        .arg(db)
        .query_async::<RedisValue>(client)
        .await
        .map(|_| ())
        .map_err(classify_redis_error)
}

fn connection_info(config: PublicConnectionConfig, status: &str, error: Option<String>) -> Value {
    json!({
        "config": config,
        "status": status,
        "errorMessage": error
    })
}

fn emit_connection_status(app: &AppHandle, id: &str, status: &str, error: Option<String>) {
    let _ = app.emit(
        CONNECTION_STATUS_EVENT,
        ConnectionStatusPayload {
            id: id.to_string(),
            status: status.to_string(),
            error,
        },
    );
}

#[tauri::command]
async fn connection_list(state: State<'_, AppState>) -> JsonResponse {
    let storage = state.storage.lock().await;
    let active = state.connections.lock().await;
    let infos: Vec<Value> = storage
        .get_connections()
        .into_iter()
        .map(|config| {
            if active.contains_key(&config.id) {
                connection_info(config, "connected", None)
            } else {
                connection_info(config, "disconnected", None)
            }
        })
        .collect();
    ok(json!(infos))
}

#[tauri::command]
async fn connection_add(
    config: ConnectionConfig,
    state: State<'_, AppState>,
    app: AppHandle,
) -> JsonResponse {
    {
        let mut storage = state.storage.lock().await;
        if let Err(err) = storage.add_connection(&config) {
            return fail("ADD_FAILED", "Failed to add connection", err);
        }
    }

    emit_connection_status(&app, &config.id, "connecting", None);
    match create_client(&config).await {
        Ok(client) => {
            state
                .connections
                .lock()
                .await
                .insert(config.id.clone(), ActiveConnection { client });
            emit_connection_status(&app, &config.id, "connected", None);
            let public_config = {
                let storage = state.storage.lock().await;
                storage.public_config_for(&config.id)
            };
            match public_config {
                Some(public_config) => ok(connection_info(public_config, "connected", None)),
                None => fail(
                    "ADD_FAILED",
                    "Failed to add connection",
                    "Connection was not saved",
                ),
            }
        }
        Err(err) => {
            let mut storage = state.storage.lock().await;
            let _ = storage.delete_connection(&config.id);
            emit_connection_status(&app, &config.id, "error", Some(err.clone()));
            fail("ADD_FAILED", "Failed to add connection", err)
        }
    }
}

#[tauri::command]
async fn connection_update(
    config: ConnectionConfig,
    state: State<'_, AppState>,
    app: AppHandle,
) -> JsonResponse {
    let config_for_connect = {
        let mut storage = state.storage.lock().await;
        if let Err(err) = storage.update_connection(&config) {
            return fail("UPDATE_FAILED", "Failed to update connection", err);
        }
        storage
            .get_connection(&config.id)
            .unwrap_or_else(|| config.clone())
    };

    let connection_id = config.id.clone();
    {
        emit_connection_status(&app, &connection_id, "connecting", None);
    }
    state.connections.lock().await.remove(&connection_id);
    match create_client(&config_for_connect).await {
        Ok(client) => {
            state
                .connections
                .lock()
                .await
                .insert(connection_id.clone(), ActiveConnection { client });
            emit_connection_status(&app, &connection_id, "connected", None);
            let public_config = {
                let storage = state.storage.lock().await;
                storage.public_config_for(&connection_id)
            };
            match public_config {
                Some(public_config) => ok(connection_info(public_config, "connected", None)),
                None => fail(
                    "UPDATE_FAILED",
                    "Failed to update connection",
                    "Connection was not saved",
                ),
            }
        }
        Err(err) => {
            emit_connection_status(&app, &connection_id, "error", Some(err.clone()));
            fail("UPDATE_FAILED", "Failed to update connection", err)
        }
    }
}

#[tauri::command]
async fn connection_delete(id: String, state: State<'_, AppState>, app: AppHandle) -> JsonResponse {
    state.connections.lock().await.remove(&id);
    let mut storage = state.storage.lock().await;
    match storage.delete_connection(&id) {
        Ok(()) => {
            emit_connection_status(&app, &id, "disconnected", None);
            ok_empty()
        }
        Err(err) => fail("DELETE_FAILED", "Failed to delete connection", err),
    }
}

#[tauri::command]
async fn connection_test(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<TestResult, String> {
    let config = if config
        .password
        .as_deref()
        .is_some_and(|password| !password.is_empty())
    {
        config
    } else {
        let storage = state.storage.lock().await;
        storage.get_connection(&config.id).unwrap_or(config)
    };
    match create_client(&config).await {
        Ok(mut client) => match timeout(
            Duration::from_millis(COMMAND_TIMEOUT_MS),
            redis::cmd("PING").query_async::<String>(&mut client),
        )
        .await
        {
            Ok(Ok(_)) => Ok(TestResult {
                success: true,
                error: None,
            }),
            Ok(Err(err)) => Ok(TestResult {
                success: false,
                error: Some(classify_redis_error(err)),
            }),
            Err(_) => Ok(TestResult {
                success: false,
                error: Some("Connection timeout: Redis server did not respond in time".to_string()),
            }),
        },
        Err(err) => Ok(TestResult {
            success: false,
            error: Some(err),
        }),
    }
}

#[tauri::command]
async fn connection_connect(
    id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> JsonResponse {
    let config = {
        let storage = state.storage.lock().await;
        storage.get_connection(&id)
    };
    let Some(config) = config else {
        return fail("NOT_FOUND", "Connection not found in storage", id);
    };
    emit_connection_status(&app, &id, "connecting", None);
    match create_client(&config).await {
        Ok(client) => {
            state
                .connections
                .lock()
                .await
                .insert(id.clone(), ActiveConnection { client });
            emit_connection_status(&app, &id, "connected", None);
            ok_empty()
        }
        Err(err) => {
            emit_connection_status(&app, &id, "error", Some(err.clone()));
            fail("CONNECT_FAILED", "Failed to connect", err)
        }
    }
}

#[tauri::command]
async fn connection_disconnect(
    id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> JsonResponse {
    state.connections.lock().await.remove(&id);
    emit_connection_status(&app, &id, "disconnected", None);
    ok_empty()
}

#[tauri::command]
async fn connection_status(id: String, state: State<'_, AppState>) -> JsonResponse {
    let status = if state.connections.lock().await.contains_key(&id) {
        "connected"
    } else {
        "disconnected"
    };
    ok(json!({ "status": status }))
}

#[tauri::command]
async fn connection_select_db(
    connection_id: String,
    db: u8,
    state: State<'_, AppState>,
) -> JsonResponse {
    match get_client(&state, &connection_id).await {
        Ok(mut client) => match redis::cmd("SELECT")
            .arg(db)
            .query_async::<RedisValue>(&mut client)
            .await
        {
            Ok(_) => ok(json!({ "db": db })),
            Err(err) => fail(
                "SELECT_DB_ERROR",
                "Failed to select database",
                classify_redis_error(err),
            ),
        },
        Err(err) => fail("SELECT_DB_ERROR", "Failed to select database", err),
    }
}

#[tauri::command]
async fn connection_db_sizes(connection_id: String, state: State<'_, AppState>) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail(
            "DB_SIZES_ERROR",
            "Failed to get database sizes",
            "Not connected",
        );
    };
    let mut sizes = serde_json::Map::new();
    for db in 0..16 {
        sizes.insert(format!("db{db}"), json!(0));
    }

    let info: RedisResult<String> = redis::cmd("INFO")
        .arg("keyspace")
        .query_async(&mut client)
        .await;
    if let Ok(raw) = info {
        for line in raw.lines() {
            if let Some((db, rest)) = line.split_once(":keys=") {
                if db.starts_with("db") {
                    let keys = rest
                        .split(',')
                        .next()
                        .and_then(|value| value.parse::<u64>().ok())
                        .unwrap_or(0);
                    sizes.insert(db.to_string(), json!(keys));
                }
            }
        }
    }
    ok(Value::Object(sizes))
}

#[tauri::command]
async fn scan_start(
    connection_id: String,
    pattern: Option<String>,
    type_filter: Option<String>,
    db: Option<u8>,
    state: State<'_, AppState>,
) -> JsonResponse {
    let session_id = format!(
        "{}:{}:{}",
        connection_id,
        timestamp_ms(),
        rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(6)
            .map(char::from)
            .collect::<String>()
    );
    let mut session = ScanSession {
        cursor: 0,
        pattern: pattern.unwrap_or_else(|| "*".to_string()),
        type_filter,
        exhausted: false,
        connection_id: connection_id.clone(),
        db: 0,
        total_scanned: 0,
    };

    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("SCAN_ERROR", "Scan failed", "Not connected");
    };
    // Point the shared connection at the database the UI is showing before
    // scanning, so the returned keys always match the active db selection.
    if let Some(db) = db {
        if let Err(err) = select_db(&mut client, i64::from(db)).await {
            return fail("SCAN_ERROR", "Scan failed", err);
        }
    }
    session.db = db.map_or_else(|| client.get_db(), i64::from);
    match fetch_next_scan_page(&mut client, &mut session).await {
        Ok(mut result) => {
            result["sessionId"] = json!(session_id.clone());
            state.scans.lock().await.insert(session_id, session);
            ok(result)
        }
        Err(err) => fail("SCAN_ERROR", "Scan failed", err),
    }
}

#[tauri::command]
async fn scan_next(session_id: String, state: State<'_, AppState>) -> JsonResponse {
    let mut session = {
        let scans = state.scans.lock().await;
        scans.get(&session_id).cloned()
    };
    let Some(mut session) = session.take() else {
        return fail("SCAN_ERROR", "Scan next failed", "Scan session not found");
    };
    if session.exhausted {
        return ok(json!({
            "keys": [],
            "cursor": "0",
            "hasMore": false,
            "totalScanned": session.total_scanned,
            "connectionId": session.connection_id,
            "db": session.db
        }));
    }

    let Ok(mut client) = get_client(&state, &session.connection_id).await else {
        return fail("SCAN_ERROR", "Scan next failed", "Not connected");
    };
    // The shared connection may have been moved to another db by an
    // interleaved scan; restore this session's db before continuing.
    if let Err(err) = select_db(&mut client, session.db).await {
        return fail("SCAN_ERROR", "Scan next failed", err);
    }
    match fetch_next_scan_page(&mut client, &mut session).await {
        Ok(result) => {
            state.scans.lock().await.insert(session_id, session);
            ok(result)
        }
        Err(err) => fail("SCAN_ERROR", "Scan next failed", err),
    }
}

#[tauri::command]
async fn scan_search(
    connection_id: String,
    pattern: String,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("SCAN_ERROR", "Search failed", "Not connected");
    };
    let mut cursor = 0_u64;
    let mut keys = Vec::new();

    loop {
        let scan_result: Result<(u64, Vec<String>), String> = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(&pattern)
            .arg("COUNT")
            .arg(DEFAULT_SCAN_COUNT)
            .query_async(&mut client)
            .await
            .map_err(classify_redis_error);
        let (next, batch) = match scan_result {
            Ok(result) => result,
            Err(err) => return fail("SCAN_ERROR", "Search failed", err),
        };
        cursor = next;
        keys.extend(batch);
        if cursor == 0 || keys.len() > SAFE_KEYS_LIMIT {
            break;
        }
    }

    let db = client.get_db();
    let infos = batch_key_info(&mut client, &keys, &connection_id, db)
        .await
        .unwrap_or_default();
    ok(json!({
        "keys": infos,
        "cursor": "0",
        "hasMore": false,
        "totalScanned": keys.len(),
        "connectionId": connection_id,
        "db": db
    }))
}

#[tauri::command]
async fn scan_cancel(session_id: String, state: State<'_, AppState>) -> JsonResponse {
    state.scans.lock().await.remove(&session_id);
    ok_empty()
}

async fn fetch_next_scan_page(
    client: &mut RedisClient,
    session: &mut ScanSession,
) -> Result<Value, String> {
    let mut keys = Vec::new();
    let is_filtered_scan = session.pattern != "*" || session.type_filter.is_some();
    let max_iterations = if is_filtered_scan {
        FILTERED_SCAN_MAX_ITERATIONS
    } else {
        usize::MAX
    };
    let mut iterations = 0;

    while keys.len() < DEFAULT_SCAN_COUNT && iterations < max_iterations {
        iterations += 1;
        let mut cmd = redis::cmd("SCAN");
        cmd.arg(session.cursor)
            .arg("MATCH")
            .arg(&session.pattern)
            .arg("COUNT")
            .arg(DEFAULT_SCAN_COUNT);
        if let Some(type_filter) = &session.type_filter {
            cmd.arg("TYPE").arg(type_filter);
        }

        let (next_cursor, batch): (u64, Vec<String>) = cmd
            .query_async(client)
            .await
            .map_err(classify_redis_error)?;
        session.cursor = next_cursor;
        session.total_scanned += batch.len();

        let filtered = if let Some(type_filter) = &session.type_filter {
            let types = batch_types(client, &batch).await?;
            batch
                .into_iter()
                .zip(types.into_iter())
                .filter_map(|(key, kind)| (kind == *type_filter).then_some(key))
                .collect::<Vec<_>>()
        } else {
            batch
        };
        keys.extend(filtered);

        if session.cursor == 0 {
            session.exhausted = true;
            break;
        }
    }

    let infos = batch_key_info(client, &keys, &session.connection_id, session.db).await?;
    Ok(json!({
        "keys": infos,
        "cursor": session.cursor.to_string(),
        "hasMore": !session.exhausted,
        "totalScanned": session.total_scanned,
        "connectionId": session.connection_id,
        "db": session.db
    }))
}

async fn batch_types(client: &mut RedisClient, keys: &[String]) -> Result<Vec<String>, String> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let mut pipeline = redis::pipe();
    for key in keys {
        pipeline.cmd("TYPE").arg(key);
    }
    let values: Vec<RedisValue> = pipeline
        .query_async(client)
        .await
        .map_err(classify_redis_error)?;
    Ok(values
        .iter()
        .map(|value| String::from_redis_value(value).unwrap_or_else(|_| "none".to_string()))
        .collect())
}

async fn batch_key_info(
    client: &mut RedisClient,
    keys: &[String],
    connection_id: &str,
    db: i64,
) -> Result<Vec<Value>, String> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let mut pipeline = redis::pipe();
    for key in keys {
        pipeline.cmd("TYPE").arg(key);
        pipeline.cmd("PTTL").arg(key);
    }
    let values: Vec<RedisValue> = pipeline
        .query_async(client)
        .await
        .map_err(classify_redis_error)?;
    let mut output = Vec::with_capacity(keys.len());
    for (index, key) in keys.iter().enumerate() {
        let kind = values
            .get(index * 2)
            .and_then(|value| String::from_redis_value(value).ok())
            .unwrap_or_else(|| "unknown".to_string());
        let ttl = values
            .get(index * 2 + 1)
            .and_then(|value| i64::from_redis_value(value).ok())
            .unwrap_or(-2);
        output.push(json!({
            "key": key,
            "type": kind,
            "ttl": ttl,
            "memory": null,
            "connectionId": connection_id,
            "db": db
        }));
    }
    Ok(output)
}

#[tauri::command]
async fn key_info(connection_id: String, key: String, state: State<'_, AppState>) -> JsonResponse {
    match get_client(&state, &connection_id).await {
        Ok(mut client) => match get_key_info_value(&mut client, &key).await {
            Ok(info) => ok(info),
            Err(err) => fail("KEY_ERROR", "Failed to get key info", err),
        },
        Err(err) => fail("KEY_ERROR", "Failed to get key info", err),
    }
}

async fn get_key_info_value(client: &mut RedisClient, key: &str) -> Result<Value, String> {
    let kind: String = redis::cmd("TYPE")
        .arg(key)
        .query_async(&mut *client)
        .await
        .map_err(classify_redis_error)?;
    let ttl: i64 = redis::cmd("PTTL")
        .arg(key)
        .query_async(&mut *client)
        .await
        .map_err(classify_redis_error)?;
    let memory: Option<u64> = redis::cmd("MEMORY")
        .arg("USAGE")
        .arg(key)
        .arg("SAMPLES")
        .arg(0)
        .query_async(&mut *client)
        .await
        .ok();
    Ok(json!({ "key": key, "type": kind, "ttl": ttl, "memory": memory }))
}

#[tauri::command]
async fn key_delete(
    connection_id: String,
    key: String,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("KEY_ERROR", "Failed to delete key", "Not connected");
    };
    match redis::cmd("DEL")
        .arg(key)
        .query_async::<RedisValue>(&mut client)
        .await
    {
        Ok(_) => ok_empty(),
        Err(err) => fail(
            "KEY_ERROR",
            "Failed to delete key",
            classify_redis_error(err),
        ),
    }
}

#[tauri::command]
async fn key_rename(
    connection_id: String,
    key: String,
    new_key: String,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("KEY_ERROR", "Failed to rename key", "Not connected");
    };
    match redis::cmd("RENAME")
        .arg(key)
        .arg(new_key)
        .query_async::<RedisValue>(&mut client)
        .await
    {
        Ok(_) => ok_empty(),
        Err(err) => fail(
            "KEY_ERROR",
            "Failed to rename key",
            classify_redis_error(err),
        ),
    }
}

#[tauri::command]
async fn key_set_ttl(
    connection_id: String,
    key: String,
    ttl: i64,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("KEY_ERROR", "Failed to set TTL", "Not connected");
    };
    let result = if ttl == -1 {
        redis::cmd("PERSIST")
            .arg(key)
            .query_async::<RedisValue>(&mut client)
            .await
    } else {
        redis::cmd("PEXPIRE")
            .arg(key)
            .arg(ttl)
            .query_async::<RedisValue>(&mut client)
            .await
    };
    match result {
        Ok(_) => ok_empty(),
        Err(err) => fail("KEY_ERROR", "Failed to set TTL", classify_redis_error(err)),
    }
}

#[tauri::command]
async fn key_add(
    connection_id: String,
    key: String,
    key_type: String,
    value: Option<Value>,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("KEY_ERROR", "Failed to add key", "Not connected");
    };
    let value = value.unwrap_or(Value::Null);
    let result = match key_type.as_str() {
        "string" => {
            let text = value.as_str().unwrap_or_default().to_string();
            redis::cmd("SET")
                .arg(key)
                .arg(text)
                .query_async::<RedisValue>(&mut client)
                .await
        }
        "hash" => {
            let mut cmd = redis::cmd("HSET");
            cmd.arg(key);
            if let Some(map) = value.as_object() {
                for (field, val) in map {
                    cmd.arg(field).arg(value_to_text(val));
                }
            }
            cmd.query_async::<RedisValue>(&mut client).await
        }
        "list" => {
            let values = json_to_string_list(&value);
            redis::cmd("RPUSH")
                .arg(key)
                .arg(values)
                .query_async::<RedisValue>(&mut client)
                .await
        }
        "set" => {
            let values = json_to_string_list(&value);
            redis::cmd("SADD")
                .arg(key)
                .arg(values)
                .query_async::<RedisValue>(&mut client)
                .await
        }
        "zset" => {
            let mut cmd = redis::cmd("ZADD");
            cmd.arg(key);
            if let Some(items) = value.as_array() {
                for item in items {
                    cmd.arg(item.get("score").and_then(Value::as_f64).unwrap_or(0.0));
                    cmd.arg(item.get("member").map(value_to_text).unwrap_or_default());
                }
            }
            cmd.query_async::<RedisValue>(&mut client).await
        }
        "stream" => {
            xadd(
                &mut client,
                &key,
                value.as_object().cloned().unwrap_or_default(),
            )
            .await
        }
        _ => return fail("KEY_ERROR", "Unsupported key type", key_type),
    };
    match result {
        Ok(_) => ok_empty(),
        Err(err) => fail("KEY_ERROR", "Failed to add key", classify_redis_error(err)),
    }
}

#[tauri::command]
async fn data_view(
    connection_id: String,
    key: String,
    options: Option<Value>,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("DATA_ERROR", "Failed to view data", "Not connected");
    };
    let options = options.unwrap_or_default();
    let kind = options
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| "unknown".to_string());
    let kind = if kind == "unknown" {
        match redis::cmd("TYPE")
            .arg(&key)
            .query_async::<String>(&mut client)
            .await
        {
            Ok(value) => value,
            Err(err) => {
                return fail(
                    "DATA_ERROR",
                    "Failed to view data",
                    classify_redis_error(err),
                )
            }
        }
    } else {
        kind
    };
    let count = options
        .get("count")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_PAGE_SIZE as u64) as usize;
    let result = match kind.as_str() {
        "string" => data_string(&mut client, &key).await,
        "hash" => data_hash(&mut client, &key, options.get("cursor"), count).await,
        "list" => {
            let start = options.get("start").or_else(|| options.get("offset"));
            data_list(&mut client, &key, start, count).await
        }
        "set" => data_set(&mut client, &key, options.get("cursor"), count).await,
        "zset" => {
            let descending = options
                .get("order")
                .and_then(Value::as_str)
                .is_some_and(|order| order.eq_ignore_ascii_case("desc"));
            data_zset(&mut client, &key, options.get("cursor"), count, descending).await
        }
        "stream" => data_stream(&mut client, &key, options.get("start"), count).await,
        _ => Err(format!("Unsupported type: {kind}")),
    };
    match result {
        Ok(value) => ok(value),
        Err(err) => fail("DATA_ERROR", "Failed to view data", err),
    }
}

async fn data_string(client: &mut RedisClient, key: &str) -> Result<Value, String> {
    let len: isize = redis::cmd("STRLEN")
        .arg(key)
        .query_async(&mut *client)
        .await
        .map_err(classify_redis_error)?;
    let raw: RedisValue = if len <= MAX_VALUE_DISPLAY_SIZE {
        redis::cmd("GET")
            .arg(key)
            .query_async(&mut *client)
            .await
            .map_err(classify_redis_error)?
    } else {
        redis::cmd("GETRANGE")
            .arg(key)
            .arg(0)
            .arg(MAX_VALUE_DISPLAY_SIZE - 1)
            .query_async(&mut *client)
            .await
            .map_err(classify_redis_error)?
    };
    Ok(string_bytes_view(
        raw,
        len.max(0) as usize,
        len > MAX_VALUE_DISPLAY_SIZE,
    ))
}

fn string_bytes_view(value: RedisValue, length: usize, truncated: bool) -> Value {
    let bytes = redis_value_to_bytes(value);
    let view = bytes_text_view(&bytes);
    json!({
        "kind": "string",
        "encoding": view.encoding,
        "value": view.text,
        "textPreview": view.text,
        "hexDump": view.hex_dump,
        "length": length,
        "previewLength": view.preview_length,
        "isBinary": view.is_binary,
        "isTruncated": truncated || bytes.len() > view.preview_length
    })
}

struct BytesTextView {
    text: String,
    encoding: &'static str,
    hex_dump: String,
    preview_length: usize,
    is_binary: bool,
}

fn bytes_text_view(bytes: &[u8]) -> BytesTextView {
    let preview_len = bytes.len().min(BINARY_PREVIEW_BYTES);
    let preview = &bytes[..preview_len];
    let text = String::from_utf8_lossy(preview).to_string();
    let is_utf8 = std::str::from_utf8(preview).is_ok();
    let has_control_bytes = preview
        .iter()
        .any(|byte| (*byte < 0x20 && !matches!(*byte, b'\n' | b'\r' | b'\t')) || *byte == 0x7f);
    let is_binary = !is_utf8 || has_control_bytes;
    BytesTextView {
        text,
        encoding: if is_binary { "binary" } else { "utf8" },
        hex_dump: hex_dump(preview),
        preview_length: preview_len,
        is_binary,
    }
}

fn redis_value_to_bytes(value: RedisValue) -> Vec<u8> {
    match value {
        RedisValue::BulkString(bytes) => bytes,
        RedisValue::SimpleString(text) => text.into_bytes(),
        RedisValue::Okay => b"OK".to_vec(),
        RedisValue::Int(value) => value.to_string().into_bytes(),
        RedisValue::Nil => Vec::new(),
        other => format!("{other:?}").into_bytes(),
    }
}

fn hex_dump(bytes: &[u8]) -> String {
    bytes
        .chunks(16)
        .enumerate()
        .map(|(row, chunk)| {
            let hex = chunk
                .iter()
                .map(|byte| format!("{byte:02X}"))
                .collect::<Vec<_>>()
                .join(" ");
            let ascii = chunk
                .iter()
                .map(|byte| match *byte {
                    0x20..=0x7e => *byte as char,
                    _ => '.',
                })
                .collect::<String>();
            format!("{:08X}  {:<47}  {}", row * 16, hex, ascii)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

async fn data_hash(
    client: &mut RedisClient,
    key: &str,
    cursor_value: Option<&Value>,
    count: usize,
) -> Result<Value, String> {
    let cursor = value_to_cursor(cursor_value);
    let (next, raw): (u64, Vec<Vec<u8>>) = redis::cmd("HSCAN")
        .arg(key)
        .arg(cursor)
        .arg("COUNT")
        .arg(count)
        .query_async(&mut *client)
        .await
        .map_err(classify_redis_error)?;
    let items: Vec<Value> = raw
        .chunks(2)
        .filter_map(|chunk| {
            let field_bytes = chunk.get(0)?;
            let value_bytes = chunk.get(1).cloned().unwrap_or_default();
            let field_view = bytes_text_view(field_bytes);
            let value_view = bytes_text_view(&value_bytes);
            Some(json!({
                "field": field_view.text,
                "value": value_view.text,
                "fieldEncoding": field_view.encoding,
                "fieldIsBinary": field_view.is_binary,
                "fieldLength": field_bytes.len(),
                "fieldPreviewLength": field_view.preview_length,
                "fieldHexDump": field_view.hex_dump,
                "valueEncoding": value_view.encoding,
                "valueIsBinary": value_view.is_binary,
                "valueLength": value_bytes.len(),
                "valuePreviewLength": value_view.preview_length,
                "valueHexDump": value_view.hex_dump,
                "valueIsTruncated": value_bytes.len() > value_view.preview_length
            }))
        })
        .collect();
    let total: Option<u64> = if cursor == 0 {
        Some(
            redis::cmd("HLEN")
                .arg(key)
                .query_async::<u64>(&mut *client)
                .await
                .map_err(classify_redis_error)?,
        )
    } else {
        None
    };
    Ok(page(items, Some(next), next != 0, total))
}

async fn data_list(
    client: &mut RedisClient,
    key: &str,
    start_value: Option<&Value>,
    count: usize,
) -> Result<Value, String> {
    let start = start_value.and_then(Value::as_i64).unwrap_or(0);
    let stop = start + count as i64 - 1;
    let raw: Vec<Vec<u8>> = redis::cmd("LRANGE")
        .arg(key)
        .arg(start)
        .arg(stop)
        .query_async(&mut *client)
        .await
        .map_err(classify_redis_error)?;
    let items: Vec<Value> = raw
        .iter()
        .enumerate()
        .map(|(offset, bytes)| {
            let view = bytes_text_view(bytes);
            json!({
                "index": start + offset as i64,
                "value": view.text,
                "valueEncoding": view.encoding,
                "valueIsBinary": view.is_binary,
                "valueLength": bytes.len(),
                "valuePreviewLength": view.preview_length,
                "valueHexDump": view.hex_dump,
                "valueIsTruncated": bytes.len() > view.preview_length
            })
        })
        .collect();
    let total: u64 = redis::cmd("LLEN")
        .arg(key)
        .query_async(&mut *client)
        .await
        .map_err(classify_redis_error)?;
    let has_more = start as u64 + (items.len() as u64) < total;
    Ok(page(items, None, has_more, Some(total)))
}

async fn data_set(
    client: &mut RedisClient,
    key: &str,
    cursor_value: Option<&Value>,
    count: usize,
) -> Result<Value, String> {
    let cursor = value_to_cursor(cursor_value);
    let (next, raw): (u64, Vec<Vec<u8>>) = redis::cmd("SSCAN")
        .arg(key)
        .arg(cursor)
        .arg("COUNT")
        .arg(count)
        .query_async(&mut *client)
        .await
        .map_err(classify_redis_error)?;
    let items: Vec<Value> = raw
        .iter()
        .map(|member_bytes| {
            let member_view = bytes_text_view(member_bytes);
            json!({
                "member": member_view.text,
                "memberEncoding": member_view.encoding,
                "memberIsBinary": member_view.is_binary,
                "memberLength": member_bytes.len(),
                "memberPreviewLength": member_view.preview_length,
                "memberHexDump": member_view.hex_dump,
                "memberIsTruncated": member_bytes.len() > member_view.preview_length
            })
        })
        .collect();
    let total = if cursor == 0 {
        Some(
            redis::cmd("SCARD")
                .arg(key)
                .query_async::<u64>(&mut *client)
                .await
                .map_err(classify_redis_error)?,
        )
    } else {
        None
    };
    Ok(page(items, Some(next), next != 0, total))
}

async fn data_zset(
    client: &mut RedisClient,
    key: &str,
    cursor_value: Option<&Value>,
    count: usize,
    descending: bool,
) -> Result<Value, String> {
    // Use ZRANGE with an offset cursor so results honor the requested sort
    // order (ZSCAN returns members in undefined order and ignores it).
    let offset = value_to_cursor(cursor_value);
    let stop = offset + count as u64 - 1;
    // ZREVRANGE for descending: works on all Redis versions, whereas
    // `ZRANGE ... REV` requires Redis 6.2+.
    let mut cmd = redis::cmd(if descending { "ZREVRANGE" } else { "ZRANGE" });
    cmd.arg(key).arg(offset).arg(stop).arg("WITHSCORES");
    let raw: Vec<Vec<u8>> = cmd
        .query_async(&mut *client)
        .await
        .map_err(classify_redis_error)?;
    let items: Vec<Value> = raw
        .chunks(2)
        .filter_map(|chunk| {
            let member_bytes = chunk.first()?;
            let score_text = chunk
                .get(1)
                .and_then(|value| std::str::from_utf8(value).ok())
                .unwrap_or("0");
            let member_view = bytes_text_view(member_bytes);
            Some(json!({
                "member": member_view.text,
                "score": score_text.parse::<f64>().unwrap_or(0.0),
                "memberEncoding": member_view.encoding,
                "memberIsBinary": member_view.is_binary,
                "memberLength": member_bytes.len(),
                "memberPreviewLength": member_view.preview_length,
                "memberHexDump": member_view.hex_dump,
                "memberIsTruncated": member_bytes.len() > member_view.preview_length
            }))
        })
        .collect();
    let total: u64 = redis::cmd("ZCARD")
        .arg(key)
        .query_async(&mut *client)
        .await
        .map_err(classify_redis_error)?;
    let next_offset = offset + items.len() as u64;
    let has_more = next_offset < total;
    Ok(page(
        items,
        has_more.then_some(next_offset),
        has_more,
        (offset == 0).then_some(total),
    ))
}

async fn data_stream(
    client: &mut RedisClient,
    key: &str,
    start_value: Option<&Value>,
    count: usize,
) -> Result<Value, String> {
    let start = start_value.and_then(Value::as_str).unwrap_or("-");
    let value: RedisValue = redis::cmd("XRANGE")
        .arg(key)
        .arg(start)
        .arg("+")
        .arg("COUNT")
        .arg(count)
        .query_async(&mut *client)
        .await
        .map_err(classify_redis_error)?;
    let items = parse_stream_entries(value);
    let has_more = items.len() >= count;
    Ok(page(items, None, has_more, None))
}

fn page<T: Serialize>(
    items: T,
    cursor: Option<u64>,
    has_more: bool,
    total_count: Option<u64>,
) -> Value {
    let mut value = json!({ "items": items, "hasMore": has_more });
    if let Some(cursor) = cursor {
        value["cursor"] = json!(cursor.to_string());
    }
    if let Some(total) = total_count {
        value["totalCount"] = json!(total);
    }
    value
}

fn value_to_cursor(value: Option<&Value>) -> u64 {
    value
        .and_then(|v| {
            v.as_str()
                .and_then(|s| s.parse().ok())
                .or_else(|| v.as_u64())
        })
        .unwrap_or(0)
}

#[tauri::command]
async fn data_update(
    connection_id: String,
    key: String,
    changes: Value,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("DATA_ERROR", "Failed to update data", "Not connected");
    };
    let kind = changes
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| "string".to_string());
    let result = match kind.as_str() {
        "string" => {
            redis::cmd("SET")
                .arg(key)
                .arg(
                    changes
                        .get("value")
                        .map(value_to_text)
                        .unwrap_or_else(|| value_to_text(&changes)),
                )
                .query_async::<RedisValue>(&mut client)
                .await
        }
        "list" => {
            redis::cmd("LSET")
                .arg(key)
                .arg(changes.get("index").and_then(Value::as_i64).unwrap_or(0))
                .arg(changes.get("value").map(value_to_text).unwrap_or_default())
                .query_async::<RedisValue>(&mut client)
                .await
        }
        "hash" => {
            redis::cmd("HSET")
                .arg(key)
                .arg(changes.get("field").map(value_to_text).unwrap_or_default())
                .arg(changes.get("value").map(value_to_text).unwrap_or_default())
                .query_async::<RedisValue>(&mut client)
                .await
        }
        "zset" => {
            redis::cmd("ZADD")
                .arg(key)
                .arg("XX")
                .arg(changes.get("score").and_then(Value::as_f64).unwrap_or(0.0))
                .arg(changes.get("member").map(value_to_text).unwrap_or_default())
                .query_async::<RedisValue>(&mut client)
                .await
        }
        _ => return fail("DATA_ERROR", "Update not supported for type", kind),
    };
    match result {
        Ok(_) => ok_empty(),
        Err(err) => fail(
            "DATA_ERROR",
            "Failed to update data",
            classify_redis_error(err),
        ),
    }
}

#[tauri::command]
async fn data_add_field(
    connection_id: String,
    key: String,
    field: Value,
    value: Option<Value>,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("DATA_ERROR", "Failed to add field", "Not connected");
    };
    let kind: String = match redis::cmd("TYPE").arg(&key).query_async(&mut client).await {
        Ok(value) => value,
        Err(err) => {
            return fail(
                "DATA_ERROR",
                "Failed to add field",
                classify_redis_error(err),
            )
        }
    };
    let result = match kind.as_str() {
        "hash" => {
            let object = field.as_object();
            let (name, text) = if let Some(object) = object {
                (
                    object.get("field").map(value_to_text).unwrap_or_default(),
                    object.get("value").map(value_to_text).unwrap_or_default(),
                )
            } else {
                (
                    value_to_text(&field),
                    value.as_ref().map(value_to_text).unwrap_or_default(),
                )
            };
            // When renaming a field, drop the old one first (HSET alone would
            // leave a stale field behind under the previous name).
            let old_field = object
                .and_then(|o| o.get("oldField"))
                .map(value_to_text)
                .filter(|old| !old.is_empty() && *old != name);
            if let Some(old_field) = old_field {
                if let Err(err) = redis::cmd("HDEL")
                    .arg(&key)
                    .arg(old_field)
                    .query_async::<RedisValue>(&mut client)
                    .await
                {
                    return fail(
                        "DATA_ERROR",
                        "Failed to add field",
                        classify_redis_error(err),
                    );
                }
            }
            redis::cmd("HSET")
                .arg(key)
                .arg(name)
                .arg(text)
                .query_async::<RedisValue>(&mut client)
                .await
        }
        "list" => {
            let object = field.as_object();
            let text = object
                .and_then(|o| o.get("value"))
                .map(value_to_text)
                .unwrap_or_else(|| value_to_text(&field));
            if let Some(index) = object.and_then(|o| o.get("index")).and_then(Value::as_i64) {
                redis::cmd("LSET")
                    .arg(key)
                    .arg(index)
                    .arg(text)
                    .query_async::<RedisValue>(&mut client)
                    .await
            } else {
                let position = object
                    .and_then(|o| o.get("position"))
                    .and_then(Value::as_str)
                    .unwrap_or("tail");
                let mut cmd = if position == "head" {
                    redis::cmd("LPUSH")
                } else {
                    redis::cmd("RPUSH")
                };
                cmd.arg(key)
                    .arg(text)
                    .query_async::<RedisValue>(&mut client)
                    .await
            }
        }
        "set" => {
            let object = field.as_object();
            let member = field
                .as_object()
                .and_then(|o| o.get("member"))
                .map(value_to_text)
                .unwrap_or_else(|| value_to_text(&field));
            if let Some(old_member) = object.and_then(|o| o.get("oldMember")).map(value_to_text) {
                if old_member == member {
                    Ok(RedisValue::Okay)
                } else {
                    match redis::cmd("SREM")
                        .arg(&key)
                        .arg(old_member)
                        .query_async::<RedisValue>(&mut client)
                        .await
                    {
                        Ok(_) => {
                            redis::cmd("SADD")
                                .arg(key)
                                .arg(member)
                                .query_async::<RedisValue>(&mut client)
                                .await
                        }
                        Err(err) => Err(err),
                    }
                }
            } else {
                redis::cmd("SADD")
                    .arg(key)
                    .arg(member)
                    .query_async::<RedisValue>(&mut client)
                    .await
            }
        }
        "zset" => {
            let object = field.as_object();
            let member = object
                .and_then(|o| o.get("member"))
                .map(value_to_text)
                .unwrap_or_else(|| value_to_text(&field));
            let score = object
                .and_then(|o| o.get("score"))
                .and_then(Value::as_f64)
                .or_else(|| value.as_ref().and_then(Value::as_f64))
                .unwrap_or(0.0);
            let xx = object
                .and_then(|o| o.get("xx"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if let Some(old_member) = object.and_then(|o| o.get("oldMember")).map(value_to_text) {
                if old_member == member {
                    redis::cmd("ZADD")
                        .arg(key)
                        .arg("XX")
                        .arg(score)
                        .arg(member)
                        .query_async::<RedisValue>(&mut client)
                        .await
                } else {
                    match redis::cmd("ZREM")
                        .arg(&key)
                        .arg(old_member)
                        .query_async::<RedisValue>(&mut client)
                        .await
                    {
                        Ok(_) => {
                            redis::cmd("ZADD")
                                .arg(key)
                                .arg(score)
                                .arg(member)
                                .query_async::<RedisValue>(&mut client)
                                .await
                        }
                        Err(err) => Err(err),
                    }
                }
            } else {
                let mut cmd = redis::cmd("ZADD");
                cmd.arg(key);
                if xx {
                    cmd.arg("XX");
                }
                cmd.arg(score)
                    .arg(member)
                    .query_async::<RedisValue>(&mut client)
                    .await
            }
        }
        "stream" => {
            let fields = field.as_object().cloned().unwrap_or_else(|| {
                serde_json::Map::from_iter([(value_to_text(&field), value.unwrap_or(Value::Null))])
            });
            xadd(&mut client, &key, fields).await
        }
        _ => return fail("DATA_ERROR", "Add field not supported for type", kind),
    };
    match result {
        Ok(_) => ok_empty(),
        Err(err) => fail(
            "DATA_ERROR",
            "Failed to add field",
            classify_redis_error(err),
        ),
    }
}

#[tauri::command]
async fn data_delete_field(
    connection_id: String,
    key: String,
    field: String,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("DATA_ERROR", "Failed to delete field", "Not connected");
    };
    let kind: String = match redis::cmd("TYPE").arg(&key).query_async(&mut client).await {
        Ok(value) => value,
        Err(err) => {
            return fail(
                "DATA_ERROR",
                "Failed to delete field",
                classify_redis_error(err),
            )
        }
    };
    let result = match kind.as_str() {
        "hash" => {
            redis::cmd("HDEL")
                .arg(key)
                .arg(field)
                .query_async::<RedisValue>(&mut client)
                .await
        }
        "list" => {
            let index = field.parse::<i64>().unwrap_or(0);
            let sentinel = format!(
                "__REDIX_DELETED_{}_{}__",
                timestamp_ms(),
                rand::random::<u32>()
            );
            if let Err(err) = redis::cmd("LSET")
                .arg(&key)
                .arg(index)
                .arg(&sentinel)
                .query_async::<RedisValue>(&mut client)
                .await
            {
                return fail(
                    "DATA_ERROR",
                    "Failed to delete field",
                    classify_redis_error(err),
                );
            }
            redis::cmd("LREM")
                .arg(key)
                .arg(1)
                .arg(sentinel)
                .query_async::<RedisValue>(&mut client)
                .await
        }
        "set" => {
            redis::cmd("SREM")
                .arg(key)
                .arg(field)
                .query_async::<RedisValue>(&mut client)
                .await
        }
        "zset" => {
            redis::cmd("ZREM")
                .arg(key)
                .arg(field)
                .query_async::<RedisValue>(&mut client)
                .await
        }
        _ => return fail("DATA_ERROR", "Delete field not supported for type", kind),
    };
    match result {
        Ok(_) => ok_empty(),
        Err(err) => fail(
            "DATA_ERROR",
            "Failed to delete field",
            classify_redis_error(err),
        ),
    }
}

async fn xadd(
    client: &mut RedisClient,
    key: &str,
    fields: serde_json::Map<String, Value>,
) -> RedisResult<RedisValue> {
    let mut cmd = redis::cmd("XADD");
    cmd.arg(key).arg("*");
    for (field, value) in fields {
        cmd.arg(field).arg(value_to_text(&value));
    }
    cmd.query_async(client).await
}

#[tauri::command]
async fn cli_execute(
    connection_id: String,
    command: String,
    confirmed: Option<bool>,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail(
            "CLI_ERROR",
            "Failed to execute CLI command",
            "Not connected",
        );
    };
    let argv = parse_command(&command);
    if argv.is_empty() {
        return ok(
            json!({ "command": command, "result": "(empty command)", "isError": true, "isWarning": false }),
        );
    }
    let command_name = argv[0].to_uppercase();
    let is_warning = DANGEROUS_COMMANDS.contains(&command_name.as_str());
    if is_warning && !confirmed.unwrap_or(false) {
        return ok(json!({
            "command": command,
            "result": "Dangerous command requires confirmation. Run the same command again to execute it.",
            "isError": false,
            "isWarning": true,
            "requiresConfirmation": true
        }));
    }
    let mut cmd = redis::cmd(&command_name);
    for arg in argv.iter().skip(1) {
        cmd.arg(arg);
    }
    let result = timeout(
        Duration::from_millis(COMMAND_TIMEOUT_MS),
        cmd.query_async::<RedisValue>(&mut client),
    )
    .await;
    match result {
        Ok(Ok(value)) => {
            let formatted = format_redis_value(&value);
            ok(json!({
            "command": command,
                "result": formatted.text,
            "isError": false,
                "isWarning": is_warning,
                "truncated": formatted.truncated
            }))
        }
        Ok(Err(err)) => ok(json!({
            "command": command,
            "result": format!("(error) {}", classify_redis_error(err)),
            "isError": true,
            "isWarning": is_warning
        })),
        Err(_) => ok(json!({
            "command": command,
            "result": format!("(error) Command timed out after {}ms", COMMAND_TIMEOUT_MS),
            "isError": true,
            "isWarning": is_warning
        })),
    }
}

fn redis_glob_escape_prefix(prefix: &str) -> String {
    let mut escaped = String::with_capacity(prefix.len());
    for ch in prefix.chars() {
        if matches!(ch, '*' | '?' | '[' | ']' | '\\') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn next_key_segment_candidate(prefix: &str, key: &str) -> Option<String> {
    let remaining = key.strip_prefix(prefix)?;
    if remaining.is_empty() {
        return None;
    }

    remaining
        .find(':')
        .map(|index| format!("{}{}", prefix, &remaining[..=index]))
        .or_else(|| Some(key.to_string()))
}

#[tauri::command]
async fn cli_complete_keys(
    connection_id: String,
    prefix: String,
    type_filter: Option<String>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("CLI_ERROR", "Failed to complete keys", "Not connected");
    };

    let max_keys = limit
        .unwrap_or(CLI_COMPLETION_MAX_KEYS)
        .clamp(1, CLI_COMPLETION_MAX_KEYS);
    let normalized_type_filter = type_filter
        .map(|kind| kind.trim().to_ascii_lowercase())
        .filter(|kind| {
            matches!(
                kind.as_str(),
                "string" | "hash" | "list" | "set" | "zset" | "stream"
            )
    });
    let pattern = format!("{}*", redis_glob_escape_prefix(&prefix));
    let fetch_limit = max_keys + 1;
    let is_deep_prefix = prefix.chars().count() >= CLI_COMPLETION_DEEP_PREFIX_MIN_CHARS;
    let scan_count = if is_deep_prefix {
        CLI_COMPLETION_DEEP_SCAN_COUNT
    } else {
        DEFAULT_SCAN_COUNT
    };
    let max_iterations = if is_deep_prefix {
        CLI_COMPLETION_DEEP_SCAN_MAX_ITERATIONS
    } else {
        CLI_COMPLETION_SCAN_MAX_ITERATIONS
    };
    let mut cursor = 0_u64;
    let mut iterations = 0_usize;
    let mut keys = Vec::new();
    let mut segments = HashSet::new();

    while (keys.len() < fetch_limit || segments.len() < fetch_limit)
        && iterations < max_iterations
    {
        iterations += 1;
        let scan_result: Result<(u64, Vec<String>), String> = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(&pattern)
            .arg("COUNT")
            .arg(scan_count)
            .query_async(&mut client)
            .await
            .map_err(classify_redis_error);
        let (next, batch) = match scan_result {
            Ok(result) => result,
            Err(err) => return fail("CLI_ERROR", "Failed to complete keys", err),
        };
        cursor = next;
        let matched_keys: Vec<String> = if let Some(expected_type) = &normalized_type_filter {
            let types = match batch_types(&mut client, &batch).await {
                Ok(types) => types,
                Err(err) => return fail("CLI_ERROR", "Failed to complete keys", err),
            };
            batch
                .into_iter()
                .zip(types.into_iter())
                .filter_map(|(key, kind)| (kind == *expected_type).then_some(key))
                .collect()
        } else {
            batch
        };

        for key in matched_keys {
            if keys.len() < fetch_limit {
                keys.push(key.clone());
            }
            if segments.len() < fetch_limit {
                if let Some(segment) = next_key_segment_candidate(&prefix, &key) {
                    segments.insert(segment);
                }
            }
        }
        if cursor == 0 {
            break;
        }
    }

    keys.sort();
    keys.dedup();
    let has_more = cursor != 0 || keys.len() > max_keys;
    keys.truncate(max_keys);
    let mut segments: Vec<String> = segments.into_iter().collect();
    segments.sort();
    segments.truncate(max_keys);

    ok(json!({
        "keys": keys,
        "segments": segments,
        "hasMore": has_more,
    }))
}

#[tauri::command]
async fn cli_complete_hash_fields(
    connection_id: String,
    key: String,
    prefix: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail(
            "CLI_ERROR",
            "Failed to complete hash fields",
            "Not connected",
        );
    };

    let max_fields = limit
        .unwrap_or(CLI_COMPLETION_MAX_KEYS)
        .clamp(1, CLI_COMPLETION_MAX_KEYS);
    let pattern = format!("{}*", redis_glob_escape_prefix(&prefix));
    let fetch_limit = max_fields + 1;
    let mut cursor = 0_u64;
    let mut iterations = 0_usize;
    let mut fields = Vec::new();

    while fields.len() < fetch_limit && iterations < CLI_COMPLETION_SCAN_MAX_ITERATIONS {
        iterations += 1;
        let scan_result: Result<(u64, Vec<Vec<u8>>), String> = redis::cmd("HSCAN")
            .arg(&key)
            .arg(cursor)
            .arg("MATCH")
            .arg(&pattern)
            .arg("COUNT")
            .arg(DEFAULT_SCAN_COUNT)
            .query_async(&mut client)
            .await
            .map_err(classify_redis_error);
        let (next, raw) = match scan_result {
            Ok(result) => result,
            Err(err) => return fail("CLI_ERROR", "Failed to complete hash fields", err),
        };
        cursor = next;
        fields.extend(
            raw.chunks(2)
                .filter_map(|chunk| chunk.first())
                .map(|field| String::from_utf8_lossy(field).to_string()),
        );
        if cursor == 0 {
            break;
        }
    }

    fields.sort();
    fields.dedup();
    let has_more = cursor != 0 || fields.len() > max_fields;
    fields.truncate(max_fields);

    ok(json!({
        "fields": fields,
        "hasMore": has_more,
    }))
}

#[tauri::command]
async fn cli_complete_members(
    connection_id: String,
    key: String,
    prefix: String,
    kind: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("CLI_ERROR", "Failed to complete members", "Not connected");
    };

    let scan_command = match kind.trim().to_ascii_lowercase().as_str() {
        "set" => "SSCAN",
        "zset" => "ZSCAN",
        _ => {
            return fail(
                "CLI_ERROR",
                "Failed to complete members",
                "Unsupported member type",
            )
        }
    };

    let max_members = limit
        .unwrap_or(CLI_COMPLETION_MAX_KEYS)
        .clamp(1, CLI_COMPLETION_MAX_KEYS);
    let pattern = format!("{}*", redis_glob_escape_prefix(&prefix));
    let fetch_limit = max_members + 1;
    let mut cursor = 0_u64;
    let mut iterations = 0_usize;
    let mut members = Vec::new();

    while members.len() < fetch_limit && iterations < CLI_COMPLETION_SCAN_MAX_ITERATIONS {
        iterations += 1;
        let scan_result: Result<(u64, Vec<Vec<u8>>), String> = redis::cmd(scan_command)
            .arg(&key)
            .arg(cursor)
            .arg("MATCH")
            .arg(&pattern)
            .arg("COUNT")
            .arg(DEFAULT_SCAN_COUNT)
            .query_async(&mut client)
            .await
            .map_err(classify_redis_error);
        let (next, raw) = match scan_result {
            Ok(result) => result,
            Err(err) => return fail("CLI_ERROR", "Failed to complete members", err),
        };
        cursor = next;
        if scan_command == "ZSCAN" {
            members.extend(
                raw.chunks(2)
                    .filter_map(|chunk| chunk.first())
                    .map(|member| String::from_utf8_lossy(member).to_string()),
            );
        } else {
            members.extend(
                raw.into_iter()
                    .map(|member| String::from_utf8_lossy(&member).to_string()),
            );
        }
        if cursor == 0 {
            break;
        }
    }

    members.sort();
    members.dedup();
    let has_more = cursor != 0 || members.len() > max_members;
    members.truncate(max_members);

    ok(json!({
        "members": members,
        "hasMore": has_more,
    }))
}

#[tauri::command]
async fn server_info(connection_id: String, state: State<'_, AppState>) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("SERVER_ERROR", "Failed to get server info", "Not connected");
    };
    match redis::cmd("INFO").query_async::<String>(&mut client).await {
        Ok(info) => ok(json!(info)),
        Err(err) => fail(
            "SERVER_ERROR",
            "Failed to get server info",
            classify_redis_error(err),
        ),
    }
}

#[tauri::command]
async fn server_metrics(connection_id: String, state: State<'_, AppState>) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail(
            "SERVER_ERROR",
            "Failed to get server metrics",
            "Not connected",
        );
    };
    let info = match redis::cmd("INFO").query_async::<String>(&mut client).await {
        Ok(value) => value,
        Err(err) => {
            return fail(
                "SERVER_ERROR",
                "Failed to get server metrics",
                classify_redis_error(err),
            )
        }
    };
    let map = parse_info_flat(&info);
    let used_memory = map
        .get("used_memory")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0_u64);
    let hits = map
        .get("keyspace_hits")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0_f64);
    let misses = map
        .get("keyspace_misses")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0_f64);
    let hit_rate = if hits + misses > 0.0 {
        hits / (hits + misses)
    } else {
        0.0
    };
    ok(json!({
        "usedMemory": used_memory,
        "usedMemoryHuman": map.get("used_memory_human").cloned().unwrap_or_default(),
        "connectedClients": map.get("connected_clients").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0),
        "totalCommandsProcessed": map.get("total_commands_processed").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0),
        "instantaneousOpsPerSec": map.get("instantaneous_ops_per_sec").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0),
        "keyspaceHits": hits as u64,
        "keyspaceMisses": misses as u64,
        "hitRate": hit_rate,
        "uptimeInSeconds": map.get("uptime_in_seconds").and_then(|v| v.parse::<u64>().ok()).unwrap_or(0),
        "dbKeys": parse_db_keys(&info)
    }))
}

#[tauri::command]
async fn server_slowlog(
    connection_id: String,
    count: Option<u64>,
    state: State<'_, AppState>,
) -> JsonResponse {
    let Ok(mut client) = get_client(&state, &connection_id).await else {
        return fail("SERVER_ERROR", "Failed to get slowlog", "Not connected");
    };
    match redis::cmd("SLOWLOG")
        .arg("GET")
        .arg(count.unwrap_or(20))
        .query_async::<RedisValue>(&mut client)
        .await
    {
        Ok(value) => ok(json!(parse_slowlog(value))),
        Err(err) => fail(
            "SERVER_ERROR",
            "Failed to get slowlog",
            classify_redis_error(err),
        ),
    }
}

fn parse_info_flat(info: &str) -> HashMap<String, String> {
    info.lines()
        .filter_map(|line| line.split_once(':'))
        .map(|(key, value)| (key.to_string(), value.trim().to_string()))
        .collect()
}

fn parse_db_keys(info: &str) -> HashMap<String, u64> {
    let mut result = HashMap::new();
    for line in info.lines() {
        if let Some((db, rest)) = line.split_once(":keys=") {
            if db.starts_with("db") {
                let keys = rest
                    .split(',')
                    .next()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
                result.insert(db.to_string(), keys);
            }
        }
    }
    result
}

fn parse_slowlog(value: RedisValue) -> Vec<Value> {
    let entries = redis_array(value);
    entries
        .into_iter()
        .filter_map(|entry| {
            let parts = redis_array(entry);
            let id = redis_i64(parts.get(0)?)?;
            let timestamp = redis_i64(parts.get(1)?)?;
            let duration = redis_i64(parts.get(2)?)?;
            let command_parts = redis_array(parts.get(3)?.clone())
                .iter()
                .filter_map(redis_string)
                .collect::<Vec<_>>();
            let client_address = parts.get(4).and_then(redis_string).unwrap_or_default();
            Some(json!({
                "id": id,
                "timestamp": timestamp,
                "duration": duration,
                "command": command_parts.join(" "),
                "clientAddress": client_address
            }))
        })
        .collect()
}

fn parse_stream_entries(value: RedisValue) -> Vec<Value> {
    redis_array(value)
        .into_iter()
        .filter_map(|entry| {
            let pair = redis_array(entry);
            let id = pair.get(0).and_then(redis_string)?;
            let values = pair.get(1).cloned().map(redis_array).unwrap_or_default();
            let mut fields = serde_json::Map::new();
            let mut field_values = Vec::new();
            for chunk in values.chunks(2) {
                let Some(field_value) = chunk.first() else {
                    continue;
                };
                let field_bytes = redis_value_to_bytes(field_value.clone());
                let value_bytes = chunk
                    .get(1)
                    .cloned()
                    .map(redis_value_to_bytes)
                    .unwrap_or_default();
                let field_view = bytes_text_view(&field_bytes);
                let value_view = bytes_text_view(&value_bytes);
                fields.insert(field_view.text.clone(), json!(value_view.text.clone()));
                field_values.push(json!({
                    "field": field_view.text,
                    "value": value_view.text,
                    "fieldEncoding": field_view.encoding,
                    "fieldIsBinary": field_view.is_binary,
                    "fieldLength": field_bytes.len(),
                    "fieldPreviewLength": field_view.preview_length,
                    "fieldHexDump": field_view.hex_dump,
                    "valueEncoding": value_view.encoding,
                    "valueIsBinary": value_view.is_binary,
                    "valueLength": value_bytes.len(),
                    "valuePreviewLength": value_view.preview_length,
                    "valueHexDump": value_view.hex_dump,
                    "valueIsTruncated": value_bytes.len() > value_view.preview_length
                }));
            }
            Some(json!({ "id": id, "fields": fields, "fieldValues": field_values }))
        })
        .collect()
}

fn redis_array(value: RedisValue) -> Vec<RedisValue> {
    match value {
        RedisValue::Array(values) => values,
        RedisValue::BulkString(values) => vec![RedisValue::BulkString(values)],
        _ => Vec::new(),
    }
}

fn redis_string(value: &RedisValue) -> Option<String> {
    String::from_redis_value(value).ok()
}

fn redis_i64(value: &RedisValue) -> Option<i64> {
    i64::from_redis_value(value).ok()
}

fn parse_command(input: &str) -> Vec<String> {
    let mut argv = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            } else if ch == '\\' {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            } else {
                current.push(ch);
            }
        } else if ch == '"' || ch == '\'' {
            quote = Some(ch);
        } else if ch.is_whitespace() {
            if !current.is_empty() {
                argv.push(std::mem::take(&mut current));
            }
        } else {
            current.push(ch);
        }
    }

    if !current.is_empty() {
        argv.push(current);
    }
    argv
}

struct FormatOutput {
    text: String,
    truncated: bool,
}

struct FormatBudget {
    remaining_bytes: usize,
    truncated: bool,
}

fn format_redis_value(value: &RedisValue) -> FormatOutput {
    let mut budget = FormatBudget {
        remaining_bytes: CLI_OUTPUT_MAX_BYTES,
        truncated: false,
    };
    let mut text = format_redis_value_inner(value, 0, &mut budget);
    if budget.truncated {
        text.push_str("\n... (truncated)");
    }
    FormatOutput {
        text,
        truncated: budget.truncated,
    }
}

fn push_limited(output: &mut String, chunk: &str, budget: &mut FormatBudget) {
    if budget.remaining_bytes == 0 {
        budget.truncated = true;
        return;
    }
    let chunk_len = chunk.len();
    if chunk_len <= budget.remaining_bytes {
        output.push_str(chunk);
        budget.remaining_bytes -= chunk_len;
        return;
    }
    let mut end = 0;
    for (index, _) in chunk.char_indices() {
        if index <= budget.remaining_bytes {
            end = index;
        } else {
            break;
        }
    }
    if end == 0 && !chunk.is_empty() {
        budget.remaining_bytes = 0;
    } else {
        output.push_str(&chunk[..end]);
        budget.remaining_bytes -= end;
    }
    budget.truncated = true;
}

fn terminal_safe_text(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '\n' | '\r' | '\t' => output.push(ch),
            '\u{1b}' => output.push_str("\\x1b"),
            ch if ch.is_control() => output.push_str(&format!("\\x{:02x}", ch as u32)),
            ch => output.push(ch),
        }
    }
    output
}

fn format_redis_value_inner(
    value: &RedisValue,
    indent: usize,
    budget: &mut FormatBudget,
) -> String {
    if indent > CLI_FORMAT_MAX_DEPTH {
        budget.truncated = true;
        return "... (max depth reached)".to_string();
    }
    if let Ok(number) = i64::from_redis_value(value) {
        return format!("(integer) {number}");
    }
    if let RedisValue::BulkString(bytes) = value {
        if let Ok(text) = std::str::from_utf8(bytes) {
            let mut output = String::new();
            push_limited(&mut output, "\"", budget);
            push_limited(&mut output, &terminal_safe_text(text), budget);
            push_limited(&mut output, "\"", budget);
            return output;
        }
        let preview_len = bytes.len().min(BINARY_PREVIEW_BYTES);
        let mut output = format!(
            "binary-data(length={}, preview={} bytes)\n{}",
            bytes.len(),
            preview_len,
            hex_dump(&bytes[..preview_len])
        );
        if bytes.len() > preview_len {
            output.push_str("\n... (truncated)");
            budget.truncated = true;
        }
        let mut limited = String::new();
        push_limited(&mut limited, &output, budget);
        return limited;
    }
    if let Ok(text) = String::from_redis_value(value) {
        let mut output = String::new();
        push_limited(&mut output, "\"", budget);
        push_limited(&mut output, &terminal_safe_text(&text), budget);
        push_limited(&mut output, "\"", budget);
        return output;
    }
    match value {
        RedisValue::Nil => "(nil)".to_string(),
        RedisValue::Array(values) => {
            if values.is_empty() {
                return "(empty array)".to_string();
            }
            let mut lines = values
                .iter()
                .take(CLI_ARRAY_MAX_ITEMS)
                .enumerate()
                .map(|(index, item)| {
                    format!(
                        "{}{}) {}",
                        "  ".repeat(indent),
                        index + 1,
                        format_redis_value_inner(item, indent + 1, budget)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            if values.len() > CLI_ARRAY_MAX_ITEMS {
                budget.truncated = true;
                lines.push_str(&format!(
                    "\n... ({} more items)",
                    values.len() - CLI_ARRAY_MAX_ITEMS
                ));
            }
            let mut output = String::new();
            push_limited(&mut output, &lines, budget);
            output
        }
        _ => terminal_safe_text(&format!("{value:?}")),
    }
}

fn value_to_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(value) => value.to_string(),
        other => other.to_string(),
    }
}

fn json_to_string_list(value: &Value) -> Vec<String> {
    match value {
        Value::Array(items) => items.iter().map(value_to_text).collect(),
        Value::Null => vec![String::new()],
        other => vec![value_to_text(other)],
    }
}

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            app.manage(AppState {
                storage: Mutex::new(Storage::new(app_data_dir.join("redix.json"))),
                connections: Mutex::new(HashMap::new()),
                scans: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connection_list,
            connection_add,
            connection_update,
            connection_delete,
            connection_test,
            connection_connect,
            connection_disconnect,
            connection_status,
            connection_select_db,
            connection_db_sizes,
            scan_start,
            scan_next,
            scan_search,
            scan_cancel,
            key_info,
            key_delete,
            key_rename,
            key_set_ttl,
            key_add,
            data_view,
            data_update,
            data_add_field,
            data_delete_field,
            cli_execute,
            cli_complete_keys,
            cli_complete_hash_fields,
            cli_complete_members,
            server_info,
            server_metrics,
            server_slowlog
        ])
        .run(tauri::generate_context!())
        .expect("error while running Redix");
}
