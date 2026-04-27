work antimatter "Antimatter — self-hosting online IDE"
  work m1-toy-project "M1: json-validator end-to-end (done)"
    targets production
    requires test FT-M1-001
    requires test FT-M1-002
    requires test FT-M1-003
    requires test FT-M1-004
    requires test FT-M1-005
  work m2-web-app "M2: web app build & deploy (planned)"
    targets production
    requires test FT-M2-001
    requires test FT-M2-002
    requires test FT-M2-003
    requires test FT-M2-006
    requires test FT-M2-008
  work m3-self-hosting "M3: self-host Antimatter"
    targets test
    targets production
    depends observability
    requires rule Bundle API Lambda
    requires rule Bundle workspace server
    requires rule Bundle frontend
    requires rule Full CDK deploy
    requires rule Promote to production
  work m4-claude-code "M4: Claude Code remote driving"
    targets production
  work observability "Unified Activity Panel + workflow traces"
    targets production
  work project-context-model "Hierarchical work + runtime contexts"
    depends observability
  runtime production "ide.antimatter.solutions — main deployed IDE"
  runtime test "Isolated AntimatterEnvStack for self-hosting validation"
