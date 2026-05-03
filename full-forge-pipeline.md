# Full Forge Release Pipeline

Two independent paths for the Full variant: Connect (existing) and Forge (new). Lite and Diagramly unchanged.

```mermaid
flowchart TD
    push["Git Push"] --> unit["Unit Tests"]
    push --> stg_lite["Staging: Lite"]
    push --> stg_full["Staging: Full Connect"]
    push --> stg_full_forge["Staging: Full Forge"]
    push --> stg_dia["Staging: Diagramly"]

    subgraph stg_full_sub["Full Connect Staging"]
        sf_cf["Build + CF Pages<br/>conf-stg-full"]
        sf_connect["Pluploader → Connect<br/>zenuml-stg.atlassian.net"]
        sf_cf --> sf_connect
    end

    subgraph stg_forge_sub["Full Forge Staging"]
        sff_cf["Build + CF Pages<br/>conf-stg-full"]
        sff_forge["Forge deploy staging"]
        sff_install["Install to<br/>full-stg.atlassian.net"]
        sff_cf --> sff_forge --> sff_install
    end

    stg_full --> stg_full_sub
    stg_full_forge --> stg_forge_sub

    stg_full_sub --> e2e_full["E2E: zenuml-full@stg"]
    stg_forge_sub --> e2e_forge["E2E: zenuml-full-forge@stg"]
    unit --> e2e_full
    unit --> e2e_forge

    e2e_full -->|master only| draft_full["Draft: v{TS}-full"]
    e2e_forge -->|master only| draft_forge["Draft: v{TS}-full-forge"]

    draft_full -->|publish| rel_full["Release: Full Connect"]
    draft_forge -->|publish| rel_forge["Release: Full Forge"]

    subgraph prod_full["Full Connect Production"]
        pf_cf["Build + CF Pages<br/>conf-full"]
        pf_manifest["Remove contentBylineItem"]
        pf_cf --> pf_manifest
    end

    subgraph prod_forge["Full Forge Production"]
        pff_cf["Build + CF Pages<br/>conf-full"]
        pff_manifest["Remove contentBylineItem"]
        pff_forge["forge:deploy:full:prod"]
        pff_cf --> pff_manifest --> pff_forge
    end

    rel_full --> prod_full
    rel_forge --> prod_forge

    style stg_full fill:#FF9800,color:#fff
    style stg_full_sub fill:#FFF3E0
    style prod_full fill:#FFF3E0
    style draft_full fill:#FF9800,color:#fff
    style sf_connect fill:#FF9800,color:#fff

    style stg_full_forge fill:#4CAF50,color:#fff
    style stg_forge_sub fill:#E8F5E9
    style prod_forge fill:#E8F5E9
    style draft_forge fill:#4CAF50,color:#fff
    style sff_forge fill:#4CAF50,color:#fff
    style pff_forge fill:#4CAF50,color:#fff
```

**Orange** = existing Connect path (kept for hotfixes) | **Green** = new Forge path

Lite and Diagramly paths are unchanged and omitted for clarity.
