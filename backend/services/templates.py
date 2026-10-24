"""SMS event catalogue. Default texts are seeded as version 1; authorized users publish new versions.

Kiswahili defaults should be reviewed by a native speaker before production use.
SMS never carries patient data, GPS, bank/wallet details or payment amounts.
"""

EVENTS: dict[str, dict] = {
    "WORKLOG_SUBMITTED": {
        "recipient": "CTC In-Charge / Supervisor",
        "variables": ["provider", "period"],
        "en": "HRH: {provider} submitted a work log for {period}. Please review it in the HRH system.",
        "sw": "HRH: {provider} amewasilisha kumbukumbu ya kazi ya {period}. Tafadhali ihakiki kwenye mfumo wa HRH.",
    },
    "WORKLOG_OTP": {
        "recipient": "Provider",
        "variables": ["period", "code", "minutes"],
        "protected": True,  # transactional OTP: not editable, body never stored or logged
        "en": "HRH: Your confirmation code for the {period} work log is {code}. It expires in {minutes} minutes. Do not share it.",
        "sw": "HRH: Namba yako ya uthibitisho kwa kumbukumbu ya kazi ya {period} ni {code}. Itaisha baada ya dakika {minutes}. Usimpe mtu yeyote.",
    },
    "WORKLOG_CONFIRMED": {
        "recipient": "Cluster / Regional Technical Officer",
        "variables": ["provider", "period"],
        "en": "HRH: The {period} work log for {provider} was verified and confirmed by the provider. It awaits your technical review.",
        "sw": "HRH: Kumbukumbu ya kazi ya {provider} ya {period} imehakikiwa na kuthibitishwa. Inasubiri mapitio yako ya kitaalamu.",
    },
    "WORKLOG_ENDORSED": {
        "recipient": "RPM",
        "variables": ["provider", "period"],
        "en": "HRH: The {period} work log for {provider} passed technical review and awaits your authorization.",
        "sw": "HRH: Kumbukumbu ya kazi ya {provider} ya {period} imepita mapitio ya kitaalamu na inasubiri idhini yako.",
    },
    "WORKLOG_APPROVED": {
        "recipient": "Provider",
        "variables": ["period"],
        "en": "HRH: Your work log for {period} has been approved. This is not a payment confirmation.",
        "sw": "HRH: Kumbukumbu yako ya kazi ya {period} imeidhinishwa. Huu si uthibitisho wa malipo.",
    },
    "WORKLOG_RETURNED": {
        "recipient": "Provider",
        "variables": ["period", "comment"],
        "en": "HRH: Your work log for {period} was returned for correction: {comment}",
        "sw": "HRH: Kumbukumbu yako ya kazi ya {period} imerudishwa kwa marekebisho: {comment}",
    },
    "WORKLOG_REOPENED": {
        "recipient": "Provider",
        "variables": ["period", "comment"],
        "en": "HRH: Your approved work log for {period} was reopened for correction: {comment}",
        "sw": "HRH: Kumbukumbu yako ya kazi ya {period} iliyoidhinishwa imefunguliwa tena kwa marekebisho: {comment}",
    },
    "WORKLOG_REJECTED": {
        "recipient": "Provider",
        "variables": ["period", "comment"],
        "en": "HRH: Your work log for {period} was rejected: {comment}",
        "sw": "HRH: Kumbukumbu yako ya kazi ya {period} imekataliwa: {comment}",
    },
    "WORKLOG_RETURNED_TO_REVIEWER": {
        "recipient": "Previous-stage reviewer",
        "variables": ["provider", "period", "comment"],
        "en": "HRH: The {period} work log for {provider} was returned to you for re-review: {comment}",
        "sw": "HRH: Kumbukumbu ya kazi ya {provider} ya {period} imerudishwa kwako kwa mapitio upya: {comment}",
    },
    "WORKLOG_REMINDER": {
        "recipient": "Currently assigned reviewer",
        "variables": ["provider", "period", "hours"],
        "en": "HRH: The {period} work log for {provider} has waited for your action for more than {hours} hours.",
        "sw": "HRH: Kumbukumbu ya kazi ya {provider} ya {period} imesubiri hatua yako kwa zaidi ya saa {hours}.",
    },
    "WORKLOG_FINANCE_REVIEW": {
        "recipient": "Regional Finance",
        "variables": ["provider", "period"],
        "en": "HRH: RPM authorized {provider}'s {period} log. Review the validated amount and route it to the correct payment channel.",
        "sw": "HRH: RPM ameidhinisha kumbukumbu ya {provider} ya {period}. Kagua kiasi na elekeza kwenye njia sahihi ya malipo.",
    },
    "WORKLOG_FINANCE_HOLD": {
        "recipient": "Regional Program Manager",
        "variables": ["provider", "period"],
        "en": "HRH: Finance routing for {provider}, {period}, is on budget hold. Review the budget before payment.",
        "sw": "HRH: Malipo ya {provider}, {period}, yamesimamishwa kwa sababu ya bajeti. Kagua bajeti kabla ya malipo.",
    },
    "CLAIM_BUDGET_HOLD": {
        "recipient": "Regional Program Manager",
        "variables": ["provider", "period", "claim_id"],
        "en": "HRH: Claim #{claim_id} for {provider}, {period}, is on budget hold. Review the claim and its budget line.",
        "sw": "HRH: Dai #{claim_id} la {provider}, {period}, limesimamishwa kwa sababu ya bajeti. Kagua dai na mstari wake wa bajeti.",
    },
    "PAYMENT_RECORDED": {
        "recipient": "Provider",
        "variables": ["period", "reference"],
        "en": "HRH: A payment for your {period} claim has been recorded as paid. Reference: {reference}.",
        "sw": "HRH: Malipo ya dai lako la {period} yamerekodiwa kuwa yamelipwa. Kumbukumbu: {reference}.",
    },
}
LANGUAGES = ("en", "sw")
PROTECTED_EVENTS = {name for name, e in EVENTS.items() if e.get("protected")}
