# Location data

`tz_locations.csv` — every region, district (council) and ward of the United Republic of Tanzania, loaded by
`python -m backend.seed` (idempotent: existing rows are matched by name and never duplicated).

- Source: Tanzania National Bureau of Statistics administrative gazetteer (2012 census geography), published by
  UN OCHA ROSA on HDX as `cod-ab-tza` (`tza_admgz_20181019.xlsx`), licence CC BY-IGO.
- Dar es Salaam is updated for the 2016 councils: Ubungo and Kigamboni wards were moved out of Kinondoni and Temeke,
  and Pembamnazi ward was added (from the MIT-licensed `Kalebu/mtaa` postcode dataset).
- Districts and wards created after 2012 elsewhere are not included. Add them under Administration → Configuration.
