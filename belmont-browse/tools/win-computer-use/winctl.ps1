# Belmont win-computer-use 브릿지: 실제 Windows 바탕화면 제어 (grok-bot이 ExternalShell로 호출).
# 사용: powershell -File winctl.ps1 <cmd> [args]
#   screenshot <out.png> [x y w h] | cursor | windows | foreground
#   move <x> <y> | click <x> <y> [left|right] | dblclick <x> <y>
#   type <text...> | key <SendKeys문법> | focus <창제목일부>
param([Parameter(Position=0)][string]$cmd, [Parameter(ValueFromRemainingArguments=$true)][string[]]$rest)
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System;using System.Runtime.InteropServices;using System.Text;
public class Win{
 [DllImport("user32.dll")]public static extern bool GetCursorPos(out P p);
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc cb,IntPtr l);
 [DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [StructLayout(LayoutKind.Sequential)]public struct P{public int X;public int Y;}
}
"@
function J($o){ $o | ConvertTo-Json -Compress }
switch ($cmd) {
 "cursor" { $p=New-Object Win+P; [void][Win]::GetCursorPos([ref]$p); J @{x=$p.X;y=$p.Y} }
 "foreground" { $h=[Win]::GetForegroundWindow(); $sb=New-Object Text.StringBuilder 256; [void][Win]::GetWindowText($h,$sb,256); J @{title=$sb.ToString()} }
 "windows" {
   $list=@(); $cb=[Win+EnumProc]{ param($h,$l) if([Win]::IsWindowVisible($h)){ $sb=New-Object Text.StringBuilder 256; [void][Win]::GetWindowText($h,$sb,256); if($sb.Length -gt 0){ $script:list+=@{h=[long]$h;title=$sb.ToString()} } } ; return $true }
   [void][Win]::EnumWindows($cb,[IntPtr]::Zero); J $list
 }
 "move" { [void][Win]::SetCursorPos([int]$rest[0],[int]$rest[1]); "OK" }
 "click" { [void][Win]::SetCursorPos([int]$rest[0],[int]$rest[1]); Start-Sleep -m 60; if($rest[2] -eq "right"){[Win]::mouse_event(0x08,0,0,0,0);[Win]::mouse_event(0x10,0,0,0,0)}else{[Win]::mouse_event(0x02,0,0,0,0);[Win]::mouse_event(0x04,0,0,0,0)}; "OK" }
 "dblclick" { [void][Win]::SetCursorPos([int]$rest[0],[int]$rest[1]); Start-Sleep -m 40; 1..2|%{[Win]::mouse_event(0x02,0,0,0,0);[Win]::mouse_event(0x04,0,0,0,0);Start-Sleep -m 40}; "OK" }
 "type" { [System.Windows.Forms.SendKeys]::SendWait(($rest -join " ")); "OK" }
 "key" { [System.Windows.Forms.SendKeys]::SendWait(($rest -join " ")); "OK" }
 "focus" {
   $target=($rest -join " "); $found=$null; $cb=[Win+EnumProc]{ param($h,$l) $sb=New-Object Text.StringBuilder 256; [void][Win]::GetWindowText($h,$sb,256); if($sb.ToString() -like "*$target*" -and [Win]::IsWindowVisible($h)){ $script:found=$h; return $false }; return $true }
   [void][Win]::EnumWindows($cb,[IntPtr]::Zero); if($found){ [void][Win]::SetForegroundWindow($found); "OK" } else { "NOT_FOUND" }
 }
 "screenshot" {
   $out=$rest[0]; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen
   if($rest.Count -ge 5){ $rx=[int]$rest[1];$ry=[int]$rest[2];$rw=[int]$rest[3];$rh=[int]$rest[4] } else { $rx=$b.X;$ry=$b.Y;$rw=$b.Width;$rh=$b.Height }
   $bmp=New-Object Drawing.Bitmap($rw,$rh); $g=[Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($rx,$ry,0,0,(New-Object Drawing.Size($rw,$rh))); $bmp.Save($out); J @{saved=$out;w=$rw;h=$rh}
 }
 default { "usage: screenshot|cursor|windows|foreground|move|click|dblclick|type|key|focus" }
}
