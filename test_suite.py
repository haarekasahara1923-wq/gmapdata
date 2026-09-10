import os
import sys
import unittest

# Ensure path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

import database
import exporter

class TestGMapExtractor(unittest.TestCase):
    def setUp(self):
        database.init_db()

    def test_deduplication(self):
        # 1. Clean test niche
        test_niche = "test_dentists_noida"
        database.clear_leads(clean_niche=test_niche)

        lead1 = {
            "niche": test_niche,
            "query": "test dentists in noida",
            "name": "Dr Smile Dental Clinic",
            "phone": "+91 98765 43210",
            "whatsapp": "919876543210",
            "email": "contact@drsmile.com",
            "website": "https://drsmile.com",
            "address": "Sector 18, Noida, Uttar Pradesh 201301",
            "rating": 4.9,
            "reviews_count": 88,
            "place_id": "place_12345",
            "map_url": "https://maps.google.com/?cid=12345",
            "session_id": "sess_test_1"
        }

        # First save: should succeed
        is_new, lead_id = database.save_lead(lead1)
        self.assertTrue(is_new, "First insertion should be registered as new")
        self.assertGreater(lead_id, 0)

        # Second save with exact same place_id: should be detected as duplicate and skipped
        is_new_dup, _ = database.save_lead(lead1)
        self.assertFalse(is_new_dup, "Duplicate insertion with same place_id should be skipped")

        # Third save with different place_id but same phone: should also be skipped
        lead_same_phone = dict(lead1)
        lead_same_phone["place_id"] = "place_different_6789"
        is_new_phone_dup, _ = database.save_lead(lead_same_phone)
        self.assertFalse(is_new_phone_dup, "Duplicate insertion with same phone should be skipped")

        # Fourth save with different phone and different place_id: should succeed
        lead_fresh = dict(lead1)
        lead_fresh["place_id"] = "place_new_9999"
        lead_fresh["phone"] = "+91 91234 56789"
        lead_fresh["name"] = "Apex Dental Care"
        is_new_fresh, id2 = database.save_lead(lead_fresh)
        self.assertTrue(is_new_fresh, "Different lead should be saved as new")

        # Clean up test niche
        database.clear_leads(clean_niche=test_niche)

    def test_exporters(self):
        sample_leads = [
            {
                "id": 1,
                "niche": "Dentists",
                "name": "Smile Clinic",
                "phone": "+91 98765 43210",
                "whatsapp": "919876543210",
                "email": "smile@example.com",
                "website": "https://example.com",
                "address": "Connaught Place, New Delhi",
                "rating": 4.8,
                "reviews_count": 150,
                "map_url": "https://maps.google.com"
            }
        ]

        # Test CSV
        csv_stream = exporter.export_to_csv(sample_leads)
        csv_bytes = csv_stream.read()
        self.assertGreater(len(csv_bytes), 50)
        self.assertTrue(b"Smile Clinic" in csv_bytes)

        # Test Excel
        excel_stream = exporter.export_to_excel(sample_leads)
        excel_bytes = excel_stream.read()
        self.assertGreater(len(excel_bytes), 1000)

        # Test PDF
        pdf_stream = exporter.export_to_pdf(sample_leads)
        pdf_bytes = pdf_stream.read()
        self.assertGreater(len(pdf_bytes), 1000)

if __name__ == '__main__':
    unittest.main()
