<?php
/**
 * Proxy to Telegram API for shared hosting without outgoing connections from Node.
 * All requests from bot go through this PHP proxy via localhost.
 */

$path = $_SERVER['PATH_INFO'] ?? '/';
$target = 'https://api.telegram.org' . $path;
$method = $_SERVER['REQUEST_METHOD'];
$body = file_get_contents('php://input');

$ch = curl_init($target);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

if ($method === 'POST') {
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$headers = [];
foreach (getallheaders() as $k => $v) {
    if (strtolower($k) === 'host' || strtolower($k) === 'content-length') continue;
    $headers[] = "$k: $v";
}
if ($body && !array_filter($headers, fn($h) => stripos($h, 'content-type:') === 0)) {
    $headers[] = 'Content-Type: application/json';
}
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

$res = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

http_response_code($httpCode);
if ($contentType) header("Content-Type: $contentType");
echo $res;
