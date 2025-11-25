use std::time::Duration;

use anyhow::Result;
use log::info;
use tokio::sync::{mpsc, watch};

use crate::infra;

pub struct ShutdownTimer {
    cancel_tx: watch::Sender<bool>,
    shutdown_tx: mpsc::Sender<()>,
    timer_task: Option<tokio::task::JoinHandle<()>>,
    duration: Duration,
}

impl ShutdownTimer {
    pub fn new(shutdown_tx: mpsc::Sender<()>, duration: Duration) -> Self {
        let (cancel_tx, _) = watch::channel(false);
        Self {
            cancel_tx,
            shutdown_tx,
            timer_task: None,
            duration,
        }
    }

    // start timer
    pub async fn start_timer(&mut self) {
        let mut cancel_rx = self.cancel_tx.subscribe();
        info!("Starting shutdown timer...");

        let shutdown_tx = self.shutdown_tx.clone();
        let duration = self.duration;

        self.timer_task = Some(tokio::spawn(async move {
            tokio::select! {
                _ = tokio::time::sleep(duration) => {
                    infra::shutdown_server().await.unwrap_or_else(|e| {
                        log::error!("Failed to shut down ECS service! {e}")
                    });
                    info!("Shutting down server process...");
                    shutdown_tx.send(()).await.unwrap();
                }
                _ = Self::wait_for_cancellation(&mut cancel_rx) => {
                    // do we actually need to do anything here? this future finishing first
                    // should be sufficient to cancel the sleep
                    info!("Shutdown timer cancelled");
                }
            }
        }));
    }

    pub async fn cancel_timer(&self) -> Result<()> {
        if !self.cancel_tx.is_closed() {
            info!("Cancelling shutdown timer...");
            self.cancel_tx.send(true)?;
        }
        Ok(())
    }

    // cancel timer

    // wait for cancelation
    async fn wait_for_cancellation(rx: &mut watch::Receiver<bool>) {
        while rx.changed().await.is_ok() {
            if *rx.borrow() {
                break;
            }
        }
    }
}
