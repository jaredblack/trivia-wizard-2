use crate::{TestClient, TestServer};

#[tokio::test]
async fn timer_closes_server_when_all_hosts_disconnect() {
    // Use a very short shutdown duration for this test (500ms)
    let mut server =
        TestServer::start_with_shutdown_duration(std::time::Duration::from_millis(250)).await;

    // Host creates a game
    let (host, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Host disconnects
    drop(host);

    // Wait for the shutdown timer to trigger
    // Use a timeout slightly longer than the shutdown duration
    let shutdown_result = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        server.shutdown_rx.recv(),
    )
    .await;

    assert!(
        shutdown_result.is_ok(),
        "Server should have shut down after host disconnected"
    );
    assert!(
        shutdown_result.unwrap().is_some(),
        "Shutdown signal should have been sent"
    );
}

#[tokio::test]
async fn timer_cancels_when_new_host_connects() {
    let mut server =
        TestServer::start_with_shutdown_duration(std::time::Duration::from_millis(500)).await;

    let (host1, _) = TestClient::connect_as_host_and_create_game(&server).await;

    drop(host1);

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let (_host2, _) = TestClient::connect_as_host_and_create_game(&server).await;

    // Wait past the original shutdown duration
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;

    // Verify shutdown did NOT happen
    let shutdown_result = tokio::time::timeout(
        std::time::Duration::from_millis(100),
        server.shutdown_rx.recv(),
    )
    .await;

    assert!(
        shutdown_result.is_err(),
        "Server should NOT have shut down because a new host connected"
    );
}

#[tokio::test]
async fn timer_does_not_cancel_when_team_connects() {
    let mut server =
        TestServer::start_with_shutdown_duration(std::time::Duration::from_millis(500)).await;

    let (host, game_code) = TestClient::connect_as_host_and_create_game(&server).await;

    drop(host);

    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Team connects and joins the game (this should NOT cancel the timer)
    let mut team = TestClient::connect(&server.ws_url()).await;
    team.join_game(&game_code, "Test Team").await;

    // Wait for the shutdown timer to trigger
    let shutdown_result = tokio::time::timeout(
        std::time::Duration::from_millis(600),
        server.shutdown_rx.recv(),
    )
    .await;

    assert!(
        shutdown_result.is_ok(),
        "Server SHOULD shut down even though team connected after host disconnected"
    );
    assert!(
        shutdown_result.unwrap().is_some(),
        "Shutdown signal should have been sent"
    );
}
