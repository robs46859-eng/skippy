-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL, -- Trying, 1st, 2nd, 3rd, Infant
  due_date DATE NULL,
  comfort_pref BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Places Table
CREATE TABLE IF NOT EXISTS places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL, -- 'seed', 'user', 'osm', 'places_api'
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bathroom', 'nursing', 'rest_stop', 'hospital')),
  address TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Reviews Table
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  cleanliness INT NOT NULL CHECK (cleanliness BETWEEN 1 AND 5),
  privacy INT NOT NULL CHECK (privacy BETWEEN 1 AND 5),
  stroller_access BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Place Aggregates Table
CREATE TABLE IF NOT EXISTS place_aggregates (
  place_id UUID PRIMARY KEY REFERENCES places(id) ON DELETE CASCADE,
  avg_cleanliness DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_privacy DOUBLE PRECISION NOT NULL DEFAULT 0,
  stroller_yes_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  review_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Aggregation Logic (Trigger)
CREATE OR REPLACE FUNCTION update_place_aggregates()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO place_aggregates (place_id, avg_cleanliness, avg_privacy, stroller_yes_pct, review_count, updated_at)
  SELECT 
    COALESCE(NEW.place_id, OLD.place_id),
    AVG(cleanliness)::DOUBLE PRECISION,
    AVG(privacy)::DOUBLE PRECISION,
    (COUNT(*) FILTER (WHERE stroller_access = TRUE) * 100.0 / COUNT(*))::DOUBLE PRECISION,
    COUNT(*)::INT,
    NOW()
  FROM reviews
  WHERE place_id = COALESCE(NEW.place_id, OLD.place_id)
  ON CONFLICT (place_id) DO UPDATE SET
    avg_cleanliness = EXCLUDED.avg_cleanliness,
    avg_privacy = EXCLUDED.avg_privacy,
    stroller_yes_pct = EXCLUDED.stroller_yes_pct,
    review_count = EXCLUDED.review_count,
    updated_at = EXCLUDED.updated_at;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_place_aggregates
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION update_place_aggregates();

-- 6. RLS Policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE places ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_aggregates ENABLE ROW LEVEL SECURITY;

-- Profiles: Own data only
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Places: Authenticated Read
CREATE POLICY "Allow authenticated read on places" ON places FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow users to suggest places" ON places FOR INSERT TO authenticated WITH CHECK (source = 'user');

-- Reviews: Authenticated Read, Own Insert/Update/Delete
CREATE POLICY "Allow authenticated read on reviews" ON reviews FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow users to insert own reviews" ON reviews FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Allow owners to update own reviews" ON reviews FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Allow owners to delete own reviews" ON reviews FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Aggregates: Authenticated Read
CREATE POLICY "Allow authenticated read on aggregates" ON place_aggregates FOR SELECT TO authenticated USING (true);
