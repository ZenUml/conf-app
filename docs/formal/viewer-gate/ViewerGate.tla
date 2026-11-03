---------------------------- MODULE ViewerGate ----------------------------
(***************************************************************************)
(* One Magic writeback call from one viewer, as the code does it today.    *)
(*                                                                         *)
(*   src/utils/magic/viewerAccount.ts   viewerAccountKind()  -> Lookup     *)
(*   src/utils/magic/ (caller)          skip or call         -> Call       *)
(*   functions/utils/forgeUserToken.ts  requireForgeUserToken -> Backend   *)
(*                                                                         *)
(* Fact the model rests on (repo CLAUDE.md, "Guest and anonymous viewers   *)
(* get no Forge user token"): Forge sends x-forge-oauth-user only for a    *)
(* licensed viewer. Guest and anonymous invocations carry no user token.   *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
    GateEnabled,         \* frontend skips the call for a known guest or anon
    MissingTokenStatus,  \* backend status when the user token is absent: 401 or 403
    FallbackToAppToken   \* backend acts with the app token when the user token is absent

ASSUME GateEnabled \in BOOLEAN
ASSUME FallbackToAppToken \in BOOLEAN
ASSUME MissingTokenStatus \in {401, 403}

VARIABLES kind, lookup, outcome
vars == <<kind, lookup, outcome>>

Kinds    == {"licensed", "guest", "anon"}
Lookups  == {"pending", "anonymous", "guest", "licensed", "unknown"}
\* "unavailable" = viewer records the call as unavailable (the 403 path).
\* "client_exception" = viewer records an exception (the 401 path).
Outcomes == {"none", "ok", "skipped", "unavailable", "client_exception", "acted_as_app"}

HasUserToken == kind = "licensed"

TypeOK == /\ kind \in Kinds
          /\ lookup \in Lookups
          /\ outcome \in Outcomes

Init == /\ kind \in Kinds
        /\ lookup = "pending"
        /\ outcome = "none"

(* viewerAccountKind: no accountId means anonymous, no lookup.            *)
(* Otherwise the bridge answers truthfully, or fails and returns unknown. *)
Lookup ==
    /\ lookup = "pending"
    /\ \/ /\ kind = "anon"
          /\ lookup' = "anonymous"
       \/ /\ kind \in {"guest", "licensed"}
          /\ lookup' = kind
       \/ /\ kind \in {"guest", "licensed"}
          /\ lookup' = "unknown"
    /\ UNCHANGED <<kind, outcome>>

Skips == GateEnabled /\ lookup \in {"anonymous", "guest"}

Skip ==
    /\ outcome = "none"
    /\ lookup /= "pending"
    /\ Skips
    /\ outcome' = "skipped"
    /\ UNCHANGED <<kind, lookup>>

Backend ==
    IF HasUserToken THEN "ok"
    ELSE IF FallbackToAppToken THEN "acted_as_app"
    ELSE IF MissingTokenStatus = 403 THEN "unavailable"
    ELSE "client_exception"

Invoke ==
    /\ outcome = "none"
    /\ lookup /= "pending"
    /\ ~Skips
    /\ outcome' = Backend
    /\ UNCHANGED <<kind, lookup>>

Done == /\ outcome /= "none"
        /\ UNCHANGED vars

Next == Lookup \/ Skip \/ Invoke \/ Done

Spec == Init /\ [][Next]_vars /\ WF_vars(Lookup \/ Skip \/ Invoke)

(***************************************************************************)
(* Properties                                                              *)
(***************************************************************************)

\* Never act for a viewer with the app's authority.
NoAppTokenFallback == outcome /= "acted_as_app"

\* A viewer with no user token is not an auth failure (the 2026-10-08 bug:
\* guests got 401 and the viewer recorded client_exception).
NoClientExceptionForTokenless == outcome /= "client_exception"

\* The gate never blocks a licensed viewer.
GateNeverBlocksLicensed == outcome = "skipped" => HasUserToken = FALSE

\* Every call ends.
Terminates == <>(outcome /= "none")

=============================================================================
