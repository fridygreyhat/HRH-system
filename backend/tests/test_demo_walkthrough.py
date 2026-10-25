from backend.services.demo_walkthrough import sample_proof_pdf, walkthrough


def test_demo_requires_sign_in_and_has_no_write_routes(api, client):
    assert client.get("/demos/workflows").status_code == 401
    assert client.get("/demos/sample-proof.pdf").status_code == 401
    response = api.get("/demos/workflows", "chw1")
    assert response["simulated"] is True
    assert response["summary"]["scenario_count"] == 16
    api.call("POST", "/demos/workflows", "chw1", expect=405)
    api.call("DELETE", "/demos/workflows", "chw1", expect=405)


def test_demo_coverage_and_role_projections():
    data = walkthrough()
    ordinary = [s for s in data["scenarios"] if s["variant"] == "happy_path"]
    assert {(s["region"], s["cadre"], s["work_type"]) for s in ordinary} == {
        (region, cadre, kind)
        for region in ("Iringa", "Njombe")
        for cadre in ("CHW", "DATA_CLERK", "HCP")
        for kind in ("SERVICES", "PAYROLL")
    }
    assert {s["route"] for s in data["scenarios"]} == {"A", "B", "C"}
    assert {s["variant"] for s in data["scenarios"]} == {"happy_path", "return", "budget_hold", "legacy"}
    for scenario in data["scenarios"]:
        assert scenario["steps"][-1]["claim"]["payment_status"] == "RECONCILED"
        for step in scenario["steps"]:
            if step["role"] == "PROVIDER":
                assert step["batch"] is None
                if step["claim"]:
                    assert step["claim"]["payment_actions"] == []
            if step["claim"] and step["claim"]["status"] == "PENDING_FINANCE_REVIEW":
                assert step["claim"]["category_name"] is None
                assert step["claim"]["payment_actions"] == []
    assert data["summary"]["step_count"] == sum(len(s["steps"]) for s in data["scenarios"])
    assert all(check["passed"] for check in data["checks"])


def test_downloaded_demo_proof_is_explicitly_not_real(api):
    result = api.call("GET", "/demos/sample-proof.pdf", "chw1")
    assert result.headers["content-type"] == "application/pdf"
    assert "DEMO-NOT-REAL-PAYMENT.pdf" in result.headers["content-disposition"]
    assert result.content == sample_proof_pdf()
    assert b"NOT PROOF OF A REAL PAYMENT" in result.content
    assert b"No money was transferred" in result.content
