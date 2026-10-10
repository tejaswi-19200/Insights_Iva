def _unwrap(data):
    if isinstance(data, dict) and "success" in data and "data" in data:
        return data["data"]
    return data


def _create_product(client, headers, sku="LEAD-PROD-1"):
    resp = client.post(
        "/api/masters/products",
        headers=headers,
        json={
            "tenant_id": 0,
            "sku": sku,
            "name": f"Lead Test Product {sku}",
            "category": "Finished Goods",
            "unit_cost": 10,
            "unit_price": 20,
        },
    )
    assert resp.status_code == 200, resp.text
    return _unwrap(resp.json())["id"]


def test_lead_next_id_and_create_happy_path(client, register_admin):
    admin = register_admin()
    headers = admin["headers"]
    user_id = admin["user"]["id"]
    product_id = _create_product(client, headers)

    next_resp = client.get("/sales/leads/next-id", headers=headers)
    assert next_resp.status_code == 200, next_resp.text
    lead_no = _unwrap(next_resp.json())["lead_no"]
    assert lead_no.startswith("LD-")

    payload = {
        "company_name": "Paper Co",
        "contact_person": "Ravi Kumar",
        "phone": "9876543210",
        "email": "ravi@example.com",
        "source": "Website",
        "status": "new",
        "priority": "medium",
        "assigned_user_id": user_id,
        "product_id": product_id,
        "quantity": 100,
        "expected_value": 50000,
        "is_draft": False,
    }
    created = client.post("/sales/leads", headers=headers, json=payload)
    assert created.status_code == 200, created.text
    body = _unwrap(created.json())
    assert body["company_name"] == "Paper Co"
    assert body["lead_no"]
    assert body["product_id"] == product_id

    summary = client.get("/sales/leads/summary", headers=headers)
    assert summary.status_code == 200, summary.text
    assert _unwrap(summary.json())["total_leads"] == 1

    listing = client.get("/sales/leads/enriched", headers=headers)
    assert listing.status_code == 200, listing.text
    assert any(row["id"] == body["id"] for row in _unwrap(listing.json()))

    converted = client.post(
        f"/sales/leads/{body['id']}/convert-to-quotation",
        headers=headers,
    )
    assert converted.status_code == 200, converted.text
    quotation = converted.json()

    listing = client.get("/sales/leads/enriched", headers=headers)
    assert listing.status_code == 200, listing.text
    listed_lead = next(row for row in _unwrap(listing.json()) if row["id"] == body["id"])
    assert listed_lead["quotation_id"] == quotation["id"]
    assert listed_lead["quotation_number"] == quotation["quote_number"]


def test_lead_create_validation_error(client, register_admin):
    admin = register_admin()
    headers = admin["headers"]
    resp = client.post(
        "/sales/leads",
        headers=headers,
        json={"company_name": "Only Co", "is_draft": False},
    )
    assert resp.status_code == 422


def test_lead_create_permission_denied(client, register_admin):
    from tests.test_rbac_roles import _create_role_user

    admin = register_admin()
    tenant_id = admin["user"]["tenant_id"]
    operator = _create_role_user(client, tenant_id, "Operator")
    headers = {"Authorization": f"Bearer {operator['access_token']}"}
    resp = client.post(
        "/sales/leads",
        headers=headers,
        json={"company_name": "X", "contact_person": "Y", "phone": "9876543210", "is_draft": True},
    )
    assert resp.status_code == 403


def _lead_payload(user_id, product_id, **extra):
    body = {
        "company_name": "Paper Co",
        "contact_person": "Ravi Kumar",
        "phone": "9876543210",
        "email": "ravi@example.com",
        "source": "Website",
        "status": "new",
        "priority": "medium",
        "assigned_user_id": user_id,
        "product_id": product_id,
        "quantity": 100,
        "expected_value": 50000,
        "is_draft": False,
    }
    body.update(extra)
    return body


def test_lead_check_duplicate_by_phone(client, register_admin):
    admin = register_admin()
    headers = admin["headers"]
    user_id = admin["user"]["id"]
    product_id = _create_product(client, headers, sku="LEAD-PROD-2")

    payload = {
        "company_name": "Dup Co",
        "contact_person": "Anita",
        "phone": "9123456789",
        "source": "Referral",
        "assigned_user_id": user_id,
        "product_id": product_id,
        "is_draft": False,
    }
    first = client.post("/sales/leads", headers=headers, json=payload)
    assert first.status_code == 200, first.text

    dup = client.get("/sales/leads/check-duplicate", headers=headers, params={"phone": "9123456789"})
    assert dup.status_code == 200, dup.text
    matches = _unwrap(dup.json())["matches"]
    assert len(matches) >= 1


def test_lead_address_pincode_and_discussions_persist(client, register_admin):
    admin = register_admin()
    headers = admin["headers"]
    user_id = admin["user"]["id"]
    product_id = _create_product(client, headers, sku="LEAD-ADDR-1")

    created = client.post(
        "/sales/leads",
        headers=headers,
        json=_lead_payload(
            user_id,
            product_id,
            address="12 MG Road\nIndiranagar",
            pincode="560001",
            city="Bengaluru",
            state="Karnataka",
            discussions=[
                {
                    "discussed_with": "Anita Rao",
                    "role": "Chief Executive Officer",
                    "details": "Discussed monthly volume and delivery timeline.",
                },
                {
                    "discussed_with": "Suresh Menon",
                    "role": "Managing Director",
                    "details": "MD asked for a revised quotation before Friday.",
                },
            ],
        ),
    )
    assert created.status_code == 200, created.text
    body = _unwrap(created.json())
    assert body["address"] == "12 MG Road\nIndiranagar"
    assert body["pincode"] == "560001"
    assert body["product_id"] == product_id
    assert len(body["discussions"]) == 2
    assert body["discussions"][0]["discussed_with"] == "Anita Rao"
    assert body["discussions"][1]["role"] == "Managing Director"

    detail = client.get(f"/sales/leads/{body['id']}", headers=headers)
    assert detail.status_code == 200, detail.text
    shown = _unwrap(detail.json())
    assert shown["address"] == "12 MG Road\nIndiranagar"
    assert shown["pincode"] == "560001"
    assert shown["city"] == "Bengaluru"
    assert len(shown["discussions"]) == 2

    patched = client.patch(
        f"/sales/leads/{body['id']}",
        headers=headers,
        json={"address": "45 Residency Road", "pincode": "560025"},
    )
    assert patched.status_code == 200, patched.text
    updated = _unwrap(patched.json())
    assert updated["address"] == "45 Residency Road"
    assert updated["pincode"] == "560025"
    assert len(updated["discussions"]) == 2


def test_lead_save_draft_without_product(client, register_admin):
    admin = register_admin()
    headers = admin["headers"]
    resp = client.post(
        "/sales/leads",
        headers=headers,
        json={
            "company_name": "Draft Co",
            "is_draft": True,
            "status": "draft",
        },
    )
    assert resp.status_code == 200, resp.text
    body = _unwrap(resp.json())
    assert body["is_draft"] is True
    assert body["status"] == "draft"
    assert body["company_name"] == "Draft Co"
    assert body["product_id"] is None


def test_lead_invalid_pincode_rejected(client, register_admin):
    admin = register_admin()
    headers = admin["headers"]
    user_id = admin["user"]["id"]
    product_id = _create_product(client, headers, sku="LEAD-PIN-1")
    resp = client.post(
        "/sales/leads",
        headers=headers,
        json=_lead_payload(user_id, product_id, pincode="012345"),
    )
    assert resp.status_code == 422


def test_lead_rejects_inactive_and_cross_tenant_product(client, register_admin):
    admin_a = register_admin()
    admin_b = register_admin()
    headers_a = admin_a["headers"]
    headers_b = admin_b["headers"]
    product_a = _create_product(client, headers_a, sku="LEAD-INACT-1")
    product_b = _create_product(client, headers_b, sku="LEAD-OTHER-1")

    inactive = client.put(
        f"/api/masters/products/{product_a}",
        headers=headers_a,
        json={"status": "inactive"},
    )
    assert inactive.status_code == 200, inactive.text

    blocked = client.post(
        "/sales/leads",
        headers=headers_a,
        json=_lead_payload(admin_a["user"]["id"], product_a),
    )
    assert blocked.status_code == 400, blocked.text

    cross = client.post(
        "/sales/leads",
        headers=headers_a,
        json=_lead_payload(admin_a["user"]["id"], product_b),
    )
    assert cross.status_code == 400, cross.text

    ok_product = _create_product(client, headers_a, sku="LEAD-OK-1")
    created = client.post(
        "/sales/leads",
        headers=headers_a,
        json=_lead_payload(admin_a["user"]["id"], ok_product),
    )
    assert created.status_code == 200, created.text
    lead_id = _unwrap(created.json())["id"]
    other = client.get(f"/sales/leads/{lead_id}", headers=headers_b)
    assert other.status_code == 404
