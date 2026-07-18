Start-Process netsh -ArgumentList 'advfirewall firewall add rule name="TankTrouble3000" dir=in action=allow protocol=TCP localport=3000' -Verb RunAs -Wait
