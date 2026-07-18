# 仓库规则

- `package.json`是唯一版本来源，锁文件和更新日志必须与其同步。
- 一次请求包含四项及以上功能或优化时，修改前自动升级版本。
- 功能组合默认提升次版本；纯修复组合默认提升修订版本，用户指定版本时以用户要求为准。
- 发行版本升级前必须创建并验证修改前ZIP快照。
- 除非经过明确批准的迁移替代，否则保留原应用ID和共享内存标识。

# Repository Rules

- `package.json` is the only version source. Keep the lock file and changelog synchronized with it.
- A request containing four or more distinct features or optimizations requires an automatic version bump before edits.
- Feature bundles increment the minor version. Fix-only bundles increment the patch version unless the user specifies a version.
- Create and verify a pre-change ZIP snapshot before any release upgrade.
- Preserve the legacy application ID and shared-memory identifiers unless an explicitly approved migration replaces them.
