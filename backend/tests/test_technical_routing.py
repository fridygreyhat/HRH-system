"""Technical review goes to the officer whose technical area covers the log's cadre."""
from .conftest import PASSWORD, submit_and_verify

from backend.models import User


def test_technical_review_follows_the_cadre(api, db, period):
    cadres = {c["code"]: c for c in api.get("/admin/cadres", "admin")}
    assert cadres["CHW"]["technical_reviewer_title"] == "Senior Regional Technical Officer, Community Engagement"
    assert cadres["DATA_CLERK"]["technical_reviewer_title"] == "Regional Strategic Information Officer"
    assert cadres["HCP"]["technical_reviewer_title"] == "Senior Regional Technical Officer, Care & Treatment"

    tofficer1 = next(u for u in api.get("/admin/users", "admin") if u["username"] == "tofficer1")
    chw_only = api.post("/admin/users", "admin", {
        "username": "srto.ce", "password": PASSWORD, "full_name": "SRTO Community Engagement", "phone": "+255700333111",
        "roles": ["TECHNICAL_OFFICER"], "scopes": [{"cluster_id": tofficer1["scopes"][0]["cluster_id"]}],
        "review_cadre_ids": [cadres["CHW"]["id"]],
    }, expect=201)
    assert chw_only["review_cadre_ids"] == [cadres["CHW"]["id"]]
    db.query(User).filter(User.id == chw_only["id"]).update({User.must_change_password: False})
    db.commit()

    log = submit_and_verify(api, "chw1", period)
    api.post(f"/worklogs/{log['id']}/otp/confirm", "chw1", {"code": log["otp"]["dev_otp"]})
    assert any(w["id"] == log["id"] for w in api.get("/worklogs?queue=true", "srto.ce"))

    # Without CHW in the technical area, the same officer no longer sees or endorses the log.
    api.put(f"/admin/users/{chw_only['id']}/review-cadres", "admin", {"cadre_ids": [cadres["HCP"]["id"]], "reason": "moved to care and treatment"})
    api.tokens.pop("srto.ce", None)
    assert all(w["id"] != log["id"] for w in api.get("/worklogs?queue=true", "srto.ce"))
    api.post(f"/worklogs/{log['id']}/actions/endorse", "srto.ce", {}, expect=404)  # outside their area, the log is hidden

    api.post(f"/worklogs/{log['id']}/actions/endorse", "tofficer1", {})
    assert any(w["id"] == log["id"] for w in api.get("/worklogs?queue=true", "rpm1"))
