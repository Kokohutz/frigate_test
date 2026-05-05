use std::num::NonZeroU32;
use std::sync::Arc;

use governor::clock::DefaultClock;
use governor::state::keyed::DefaultKeyedStateStore;
use governor::{Quota, RateLimiter};

type KeyedLimiter = RateLimiter<String, DefaultKeyedStateStore<String>, DefaultClock>;

/// Per-camera token bucket rate limiter.
///
/// Constructed with a maximum number of events allowed per minute per camera.
/// Uses the `governor` crate's keyed rate limiter so each camera gets its
/// own independent quota.
pub struct EventRateLimiter {
    limiter: Arc<KeyedLimiter>,
}

impl EventRateLimiter {
    /// Create a limiter allowing `max_per_minute` events per camera per minute.
    ///
    /// Panics if `max_per_minute` is 0 (use at least 1).
    pub fn new(max_per_minute: u32) -> Self {
        let burst = NonZeroU32::new(max_per_minute.max(1)).expect("max_per_minute must be > 0");
        // Fill `burst` tokens per minute (i.e. one token every 60/burst seconds)
        let quota = Quota::per_minute(burst);
        let limiter = Arc::new(RateLimiter::keyed(quota));
        Self { limiter }
    }

    /// Returns `true` if the event for the given camera should be allowed through.
    /// Returns `false` if the rate limit has been exceeded.
    pub fn allow(&self, camera: &str) -> bool {
        self.limiter.check_key(&camera.to_string()).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allow_within_limit() {
        // Limit of 10/min — first 10 calls for the same camera should be allowed
        let rl = EventRateLimiter::new(10);
        for _ in 0..10 {
            assert!(rl.allow("cam1"), "expected allow within burst");
        }
    }

    #[test]
    fn test_deny_over_limit() {
        // Limit of 2/min — third call should be denied
        let rl = EventRateLimiter::new(2);
        assert!(rl.allow("cam2"));
        assert!(rl.allow("cam2"));
        assert!(!rl.allow("cam2"), "expected denial after burst exhausted");
    }

    #[test]
    fn test_different_cameras_independent() {
        // Each camera has its own bucket
        let rl = EventRateLimiter::new(1);
        assert!(rl.allow("cam_a"), "cam_a first call should pass");
        assert!(!rl.allow("cam_a"), "cam_a second call should fail");
        assert!(
            rl.allow("cam_b"),
            "cam_b first call should pass independently"
        );
    }
}
