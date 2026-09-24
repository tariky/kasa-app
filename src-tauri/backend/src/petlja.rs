//! "Event loop" backenda. U Electronu je main proces jedna JS nit: handler
//! radi bez prekida do prvog `await` (štampa na Tring, sistemski dijalog), a
//! za to vrijeme drugi IPC pozivi mogu raditi. Ovdje je to isto: poziv drži
//! petlju dok radi, a otpušta je samo dok čeka uređaj ili dijalog
//! ([`Petlja::odmor`]). Red je FIFO (tiketi), pa pozivi idu redom kojim su
//! stigli, kao poruke u JS redu.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Condvar, Mutex};
use std::thread::{self, ThreadId};

#[derive(Default)]
struct Stanje {
    sljedeci: u64,
    na_redu: u64,
    vlasnik: Option<ThreadId>,
}

#[derive(Default)]
pub struct Petlja {
    stanje: Mutex<Stanje>,
    cv: Condvar,
    /// Dubina otvorenih transakcija (vidi `Db::tx`): u transakciji se petlja
    /// ne otpušta — better-sqlite3 transakcija ne može sadržavati `await`.
    pub(crate) transakcije: AtomicU32,
}

/// Mjesto u redu, uzeto kad je poziv stigao.
pub struct Tiket(u64);

/// Petlja je zauzeta dok ovo živi.
pub struct Zauzeta<'a>(&'a Petlja);

/// Petlja je otpuštena dok ovo živi; na kraju se poziv vraća u red.
pub struct Odmor<'a>(Option<&'a Petlja>);

impl Petlja {
    pub fn nova() -> Self {
        Self::default()
    }

    /// Uzme mjesto u redu (redoslijed dolaska).
    pub fn tiket(&self) -> Tiket {
        let mut s = self.stanje.lock().unwrap_or_else(|e| e.into_inner());
        let t = s.sljedeci;
        s.sljedeci += 1;
        Tiket(t)
    }

    /// Čeka svoj red i zauzme petlju.
    pub fn uzmi(&self, tiket: Tiket) -> Zauzeta<'_> {
        let mut s = self.stanje.lock().unwrap_or_else(|e| e.into_inner());
        while s.na_redu != tiket.0 {
            s = self.cv.wait(s).unwrap_or_else(|e| e.into_inner());
        }
        s.vlasnik = Some(thread::current().id());
        Zauzeta(self)
    }

    fn pusti(&self) {
        let mut s = self.stanje.lock().unwrap_or_else(|e| e.into_inner());
        s.vlasnik = None;
        s.na_redu += 1;
        self.cv.notify_all();
    }

    /// Otpusti petlju dok se čeka nešto spolja (HTTP, dijalog). Bez učinka
    /// ako ova nit ne drži petlju ili je transakcija otvorena.
    pub fn odmor(&self) -> Odmor<'_> {
        {
            let s = self.stanje.lock().unwrap_or_else(|e| e.into_inner());
            if s.vlasnik != Some(thread::current().id()) || self.transakcije.load(Ordering::SeqCst) > 0 {
                return Odmor(None);
            }
        }
        self.pusti();
        Odmor(Some(self))
    }
}

impl Drop for Zauzeta<'_> {
    fn drop(&mut self) {
        self.0.pusti();
    }
}

impl Drop for Odmor<'_> {
    fn drop(&mut self) {
        if let Some(p) = self.0 {
            // Nastavak poslije `await` ide na kraj reda.
            let t = p.tiket();
            std::mem::forget(p.uzmi(t));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn red_i_odmor() {
        let p = Arc::new(Petlja::nova());
        let log = Arc::new(Mutex::new(Vec::new()));
        let t1 = p.tiket();
        let t2 = p.tiket();
        let (p1, l1) = (p.clone(), log.clone());
        let a = thread::spawn(move || {
            let _z = p1.uzmi(t1);
            l1.lock().unwrap().push("1: prije štampe");
            {
                let _o = p1.odmor();
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            l1.lock().unwrap().push("1: poslije štampe");
        });
        std::thread::sleep(std::time::Duration::from_millis(20));
        let (p2, l2) = (p.clone(), log.clone());
        let b = thread::spawn(move || {
            let _z = p2.uzmi(t2);
            l2.lock().unwrap().push("2");
        });
        a.join().unwrap();
        b.join().unwrap();
        assert_eq!(*log.lock().unwrap(), vec!["1: prije štampe", "2", "1: poslije štampe"]);
    }
}
